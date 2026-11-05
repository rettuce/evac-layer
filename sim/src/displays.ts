import {
  BufferAttribute, CanvasTexture, LinearFilter, Mesh, MeshBasicMaterial, Object3D, PlaneGeometry, SRGBColorSpace,
  TextureLoader, Vector3, VideoTexture, type Texture,
} from 'three'
import {
  COORD_GLYPHS, D21_MARGIN, OVERLAY_CORNERS, OVERLAY_INK, clockSweep, drawOverlay, formatClockJst, formatCoords, labelFont,
  overlayGeometry, timeFont, type OverlayCorner, type OverlayGeometry,
} from '../../app/layout/ambient/overlay'
import { hashString } from '../../app/layout/ambient/rng'
import { faceWindow, type AmbientScene, type Content, type CropsFile, type DisplayExtras } from './crops'

export type VideoTier = '4k' | '8k'

const AMBIENT_BASE: string = import.meta.env.VITE_AMBIENT_BASE ?? `${import.meta.env.BASE_URL}ambient/`
const ALERT_BASE = `${import.meta.env.BASE_URL}alert/`
const PAIRS = ['ja_easy-en', 'zh_hans-zh_hant', 'ko-th', 'vi-tl', 'id'] as const
const PAIR_MS = 2500
const EVAC_BLACKOUT_MS = 300
// Four redraws a second keep the sweep marker moving smoothly without re-uploading 22 canvases every frame.
const CLOCK_INTERVAL_MS = 250
const CLOCK_MAX_SIDE_PX = 1024
const CLOCK_LIFT_M = 0.001
const HOUR_MS = 3600000
const PILLAR_FACES = 4
const PORTRAIT_CLOCK_TOP = 0.36
const PILLAR_CLOCK_TOP_PX = 5046 - (2.0 - 0.4) * 1577
const RULE_ALPHA = 0.14
const SITE_NAME = '羽後本荘駅'
const COORDS = formatCoords(39.38633978, 140.0563304)
const INK: Record<AmbientScene, keyof typeof OVERLAY_INK> = {
  'brush-flow': 'light', 'etched-streams': 'light', 'ink-bloom': 'dark', 'painterly-flow': 'light',
  'quad-subdivision': 'dark',
}

const black = new MeshBasicMaterial({ color: 0x000000 })

// The bezel plane sits 0.5 mm behind the face, which z-fights from a few metres away without the offset.
function faceMaterial(map: Texture): MeshBasicMaterial {
  return new MeshBasicMaterial({ map, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 })
}

export interface Face {
  extras: DisplayExtras
  mesh: Mesh
  calmGeometry: PlaneGeometry
  evacGeometry: PlaneGeometry
  clock: Mesh
  clockCanvas: HTMLCanvasElement
  clockTexture: CanvasTexture
  clockScale: number
  alertSrc: string
}

export function isDisplayMesh(object: Object3D): object is Mesh {
  return object instanceof Mesh && typeof object.userData.screen === 'string'
}

function planeWithUv(size: [number, number], u0: number, u1: number, vTop: number, vBot: number): PlaneGeometry {
  const geometry = new PlaneGeometry(size[0], size[1])
  geometry.setAttribute('uv', new BufferAttribute(new Float32Array([u0, vTop, u1, vTop, u0, vBot, u1, vBot]), 2))
  return geometry
}

function calmGeometry(extras: DisplayExtras, crops?: CropsFile): PlaneGeometry {
  const [x, y, w, h] = faceWindow(extras, 'calm', crops) ?? crops?.crops[extras.screen] ?? extras.crop
  const [W, H] = crops?.canvas ?? extras.canvas
  return planeWithUv(extras.size, x / W, (x + w) / W, 1 - y / H, 1 - (y + h) / H)
}

function evacGeometry(extras: DisplayExtras): PlaneGeometry {
  if (extras.shape !== 'pillar') return planeWithUv(extras.size, 0, 1, 1, 0)
  return planeWithUv(extras.size, extras.face / PILLAR_FACES, (extras.face + 1) / PILLAR_FACES, 1, 0)
}

function alertSrc(extras: DisplayExtras): string {
  return extras.shape === '9x16' ? extras.screen : extras.shape
}

function faceFromMesh(mesh: Mesh, crops?: CropsFile): Face {
  const extras = mesh.userData as DisplayExtras
  mesh.visible = false
  const center = new Vector3(...extras.center)
  const normal = new Vector3(...extras.normal)
  const calm = calmGeometry(extras, crops)
  const board = new Mesh(calm, black)
  board.position.copy(center)
  board.lookAt(center.clone().add(normal))
  mesh.parent!.add(board)

  const [w, h] = extras.face_px
  const clockScale = Math.min(1, CLOCK_MAX_SIDE_PX / Math.max(w, h))
  const clockCanvas = document.createElement('canvas')
  clockCanvas.width = Math.ceil(w * clockScale)
  clockCanvas.height = Math.ceil(h * clockScale)
  const clockTexture = new CanvasTexture(clockCanvas)
  clockTexture.colorSpace = SRGBColorSpace
  const clock = new Mesh(
    new PlaneGeometry(extras.size[0], extras.size[1]),
    // Pulled further forward than the face material's offset, which otherwise wins over the 1 mm lift.
    new MeshBasicMaterial({
      map: clockTexture, transparent: true, depthWrite: false, toneMapped: false,
      polygonOffset: true, polygonOffsetFactor: -8, polygonOffsetUnits: -8,
    }),
  )
  clock.renderOrder = 1
  clock.position.copy(center).addScaledVector(normal, CLOCK_LIFT_M)
  clock.quaternion.copy(board.quaternion)
  mesh.parent!.add(clock)

  return {
    extras, mesh: board, calmGeometry: calm, evacGeometry: evacGeometry(extras), clock, clockCanvas, clockTexture, clockScale,
    alertSrc: alertSrc(extras),
  }
}

function scaledGeometry(geometry: OverlayGeometry, k: number): OverlayGeometry {
  const { block } = geometry
  return {
    scale: geometry.scale * k,
    areaWidth: geometry.areaWidth * k,
    block: { left: block.left * k, top: block.top === undefined ? undefined : block.top * k, bottom: block.bottom === undefined ? undefined : block.bottom * k, width: block.width * k },
    rules: geometry.rules.map((x) => x * k),
  }
}

function pillarRules(face: number, faceWidth: number, faceHeight: number, scale: number): number[] {
  const all = overlayGeometry(faceWidth * PILLAR_FACES, faceHeight, 'top-left', scale).rules
  return all.map((x) => x - face * faceWidth).filter((x) => x >= 0 && x < faceWidth)
}

function clockGeometry(extras: DisplayExtras, corner: OverlayCorner): OverlayGeometry {
  const [w, h] = extras.face_px
  if (extras.shape === 'pillar') {
    const front = overlayGeometry(w, h, 'top-left')
    return { ...front, rules: pillarRules(extras.face, w, h, front.scale), block: { ...front.block, top: PILLAR_CLOCK_TOP_PX, bottom: undefined } }
  }
  const geometry = overlayGeometry(w, h, corner)
  if (extras.shape === '9x16') return { ...geometry, block: { ...geometry.block, top: Math.round(h * PORTRAIT_CLOCK_TOP), bottom: undefined } }
  return geometry
}

function drawRules(ctx: CanvasRenderingContext2D, geometry: OverlayGeometry, ink: keyof typeof OVERLAY_INK): void {
  const [r, g, b] = OVERLAY_INK[ink]
  const margin = D21_MARGIN * geometry.scale
  const { height } = ctx.canvas
  ctx.save()
  ctx.fillStyle = `rgb(${r} ${g} ${b})`
  ctx.globalAlpha = RULE_ALPHA
  for (const x of geometry.rules) ctx.fillRect(Math.round(x), Math.round(margin), 1, Math.round(height - 2 * margin))
  ctx.restore()
}

function waitCanPlay(video: HTMLVideoElement): Promise<void> {
  return new Promise((resolve, reject) => {
    video.addEventListener('canplay', () => resolve(), { once: true })
    video.addEventListener('error', () => reject(new Error(`video failed: ${video.src}`)), { once: true })
  })
}

function detectTier(): VideoTier {
  const query = new URLSearchParams(location.search).get('video')
  if (query !== '8k') return '4k'
  const support = document.createElement('video').canPlayType('video/mp4; codecs="hvc1.1.6.L153.B0"')
  return support === 'probably' || support === 'maybe' ? '8k' : '4k'
}

function releaseVideo(video: HTMLVideoElement, texture: VideoTexture): void {
  video.pause()
  video.removeAttribute('src')
  video.load()
  texture.dispose()
}

export class Displays {
  readonly faces: Face[]
  readonly tier = detectTier()
  content: Content
  scene: AmbientScene
  private videoElement?: HTMLVideoElement
  private videoTexture?: VideoTexture
  private calmMaterial?: MeshBasicMaterial
  private readonly alertMaterials = new Map<string, MeshBasicMaterial>()
  private pairIndex = -1
  private blackout = false
  private blackoutTimer?: ReturnType<typeof setTimeout>
  private sceneRequest = 0
  private lastClockMs = -Infinity
  private fontsReady = false

  constructor(meshes: Mesh[], private readonly crops: CropsFile | undefined, initial: { content: Content; scene: AmbientScene }) {
    this.content = initial.content
    this.scene = initial.scene
    this.faces = meshes.map((mesh) => faceFromMesh(mesh, crops))
    this.apply()
  }

  videoUrl(scene: AmbientScene): string {
    return `${AMBIENT_BASE}${scene}-${this.tier}.mp4`
  }

  // The vite dev server answers a missing file with index.html and 200, so the type is checked as well as the status.
  async hasVideo(scene: AmbientScene): Promise<boolean> {
    try {
      const response = await fetch(this.videoUrl(scene), { method: 'HEAD' })
      return response.ok && (response.headers.get('content-type') ?? '').startsWith('video/')
    } catch {
      return false
    }
  }

  get video(): HTMLVideoElement | undefined {
    return this.videoElement
  }

  async start(): Promise<void> {
    void Promise.all([
      document.fonts.load(timeFont(1), '0123456789:'),
      document.fonts.load(labelFont(1), SITE_NAME + COORD_GLYPHS),
    ]).then(() => {
      this.fontsReady = true
    })
    const { video, texture } = await this.openVideo(this.scene)
    this.videoElement = video
    this.videoTexture = texture
    this.calmMaterial = faceMaterial(texture)
    this.apply()
    this.loadAlerts()
  }

  setContent(content: Content): void {
    if (content === this.content) return
    this.content = content
    clearTimeout(this.blackoutTimer)
    this.blackout = content === 'evac'
    if (this.blackout) {
      this.blackoutTimer = setTimeout(() => {
        this.blackout = false
        this.apply()
      }, EVAC_BLACKOUT_MS)
    }
    this.lastClockMs = -Infinity
    this.apply()
  }

  async setScene(scene: AmbientScene): Promise<void> {
    const request = ++this.sceneRequest
    const { video, texture } = await this.openVideo(scene)
    if (request !== this.sceneRequest) {
      releaseVideo(video, texture)
      return
    }
    const previous = this.videoElement && this.videoTexture ? { video: this.videoElement, texture: this.videoTexture } : undefined
    this.scene = scene
    this.videoElement = video
    this.videoTexture = texture
    if (this.calmMaterial) this.calmMaterial.map = texture
    else this.calmMaterial = faceMaterial(texture)
    this.lastClockMs = -Infinity
    this.apply()
    if (previous) releaseVideo(previous.video, previous.texture)
  }

  update(): void {
    const now = Date.now()
    const pair = Math.floor(now / PAIR_MS) % PAIRS.length
    if (pair !== this.pairIndex) {
      this.pairIndex = pair
      if (this.content === 'evac') this.apply()
    }
    if (this.content === 'calm' && this.fontsReady && now - this.lastClockMs >= CLOCK_INTERVAL_MS) {
      this.lastClockMs = now
      this.drawClocks(now)
    }
  }

  private async openVideo(scene: AmbientScene): Promise<{ video: HTMLVideoElement; texture: VideoTexture }> {
    const video = document.createElement('video')
    video.muted = true
    video.loop = true
    video.playsInline = true
    video.autoplay = true
    video.preload = 'auto'
    // No crossOrigin: the loops are served from the simulator's own origin, and a CORS request would need headers the host may not send.
    video.src = this.videoUrl(scene)
    await waitCanPlay(video)
    await video.play()
    const texture = new VideoTexture(video)
    texture.colorSpace = SRGBColorSpace
    texture.minFilter = LinearFilter
    texture.magFilter = LinearFilter
    texture.generateMipmaps = false
    return { video, texture }
  }

  private loadAlerts(): void {
    const loader = new TextureLoader()
    const sources = new Set(this.faces.map((face) => face.alertSrc))
    for (const src of sources) {
      PAIRS.forEach((pair, index) => {
        loader.load(`${ALERT_BASE}${src}/${pair}.png`, (texture) => {
          texture.colorSpace = SRGBColorSpace
          this.alertMaterials.set(`${src}/${index}`, faceMaterial(texture))
          if (this.content === 'evac') this.apply()
        })
      })
    }
  }

  private apply(): void {
    const calm = this.content === 'calm'
    for (const face of this.faces) {
      face.clock.visible = calm
      if (calm) {
        face.mesh.geometry = face.calmGeometry
        face.mesh.material = this.calmMaterial ?? black
      } else {
        face.mesh.geometry = face.evacGeometry
        face.mesh.material = this.blackout ? black : this.alertMaterials.get(`${face.alertSrc}/${this.pairIndex}`) ?? black
      }
    }
  }

  private drawClocks(now: number): void {
    const slot = Math.floor(now / HOUR_MS)
    const ink = INK[this.scene]
    const [W, H] = this.crops?.canvas ?? this.faces[0]!.extras.canvas
    const corner = OVERLAY_CORNERS[hashString(`room:${W}x${H}:concourse:${slot}:corner`) % OVERLAY_CORNERS.length]!
    const content = { siteName: SITE_NAME, coords: COORDS, time: formatClockJst(now), sweep: clockSweep(now), ink }
    for (const face of this.faces) {
      const ctx = face.clockCanvas.getContext('2d')!
      ctx.clearRect(0, 0, face.clockCanvas.width, face.clockCanvas.height)
      const geometry = scaledGeometry(clockGeometry(face.extras, corner), face.clockScale)
      if (face.extras.shape === 'pillar' && face.extras.face !== 0) drawRules(ctx, geometry, ink)
      else drawOverlay(ctx, geometry, content)
      face.clockTexture.needsUpdate = true
    }
  }
}
