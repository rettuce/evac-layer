import { Mesh, MeshBasicMaterial, NoBlending, Object3D, PerspectiveCamera, PlaneGeometry, Scene, Vector3 } from 'three'
import { CSS3DObject } from 'three/addons/renderers/CSS3DRenderer.js'
import { SCREEN_ORIGIN, faceWindow, screenUrl, type AmbientScene, type Content, type CropsFile, type DisplayExtras } from './screenUrl'

// The pillar page lays its four faces side by side; a face iframe shows one quarter of it.
const PILLAR_PAGE_WIDTH_PX = 6616
// CSS zoom lowers the devicePixelRatio the page sees, so its canvas is rastered at about the size it has on
// screen: 16 pillar faces (6616x5046 each) at zoom 1 ran at 6 fps, and a page rastered far larger than it is
// drawn was left partly unpainted (black bands) by the compositor; the ladder keeps the backing store within
// one step of the projected size (measured 2026-11-04). The pillar page is capped because four of its faces
// are rastered per column.
const ZOOM_LADDER = [0.125, 0.25, 0.5, 1]
const MAX_ZOOM: Record<DisplayExtras['shape'], number> = { pillar: 0.5, '9x16': 1, '32x9': 1 }
// Pages open a few at a time, the faces turned to the camera first: 44 documents at once held the page at
// 10 fps for 15 s (S-4, 2026-11-05).
const LOAD_CONCURRENCY = 4
const LOAD_TIMEOUT_MS = 10000

// A hidden page loads under `visibility: hidden` (a display-none iframe does not load in Chrome) and is then
// parked by `CSS3DObject.visible = false`, which the renderer turns into `display: none` and pauses its
// animation frames: 44 live pages ran the view at 10 fps, parked ones cost nothing, and a parked page resumes
// on the next frame when shown (S-4, 2026-11-05). The renderer rewrites `display` every frame, so it is the
// object flag that must change, not the style.
function showPage(page: Page, shown: boolean): void {
  page.shown = shown
  page.object.visible = (shown && page.facing) || !page.loaded
  page.box.style.visibility = shown ? '' : 'hidden'
}
const CONTENTS: Content[] = ['calm', 'evac']

// Writes depth and clears colour, so the room in front hides the page and the page shows through from below.
// The bezel plane sits 0.5 mm behind the face, which z-fights from a few metres away without the offset.
export const holeMaterial = new MeshBasicMaterial({
  color: 0x000000, blending: NoBlending, opacity: 0, premultipliedAlpha: true,
  polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
})

export interface Page {
  content: Content
  scene: AmbientScene
  object: CSS3DObject
  iframe: HTMLIFrameElement
  box: HTMLDivElement
  clip: HTMLDivElement
  zoom: number
  loaded: boolean
  shown: boolean
  // A face turned away from the camera is parked too (S-4 v2): its page draws nothing anyone can see.
  facing: boolean
}

export interface Face {
  extras: DisplayExtras
  // The depth-only quad: the same rectangle as the CSS3D plane, so no part of the hole lacks a page behind it
  // (the glb's curved LED wrap as the hole left the column corners uncovered: S-2, 2026-11-04).
  hole: Mesh
  pages: Partial<Record<Content, Page>>
}

export function isDisplayMesh(object: Object3D): object is Mesh {
  return object instanceof Mesh && typeof object.userData.screen === 'string'
}

const toCamera = new Vector3()
const faceNormal = new Vector3()

function faceFromMesh(mesh: Mesh): Face {
  const extras = mesh.userData as DisplayExtras
  mesh.visible = false
  const center = new Vector3(...extras.center)
  const normal = new Vector3(...extras.normal)
  const hole = new Mesh(new PlaneGeometry(extras.size[0], extras.size[1]), holeMaterial)
  hole.position.copy(center)
  hole.lookAt(center.clone().add(normal))
  mesh.parent!.add(hole)
  return { extras, hole, pages: {} }
}

function facesCameraFirst(faces: Face[], camera: PerspectiveCamera): Face[] {
  const score = (face: Face) => {
    const center = new Vector3(...face.extras.center)
    const normal = new Vector3(...face.extras.normal)
    const toEye = toCamera.copy(camera.position).sub(center)
    return normal.dot(toEye) > 0 ? toEye.length() : 1000 + toEye.length()
  }
  return [...faces].sort((a, b) => score(a) - score(b))
}

function loadedOrTimedOut(iframe: HTMLIFrameElement): Promise<void> {
  return new Promise((resolve) => {
    const done = () => resolve()
    iframe.addEventListener('load', done, { once: true })
    setTimeout(done, LOAD_TIMEOUT_MS)
  })
}

// Both contents stay loaded for every face, so switching is a visibility change; a scene change loads the
// new calm pages beside the shown ones and swaps them in once all have loaded (田中 S-4, 2026-11-05).
export class Displays {
  readonly faces: Face[]
  content: Content
  scene: AmbientScene
  loadedPages = 0
  onProgress: (loaded: number, total: number) => void = () => {}
  private queue: (() => Promise<void>)[] = []
  private running = 0

  constructor(private readonly stage: Scene, meshes: Mesh[], private readonly crops: CropsFile | undefined,
    initial: { content: Content; scene: AmbientScene }, camera: PerspectiveCamera) {
    this.content = initial.content
    this.scene = initial.scene
    this.faces = meshes.map(faceFromMesh)
    const ordered = facesCameraFirst(this.faces, camera)
    for (const content of [initial.content, ...CONTENTS.filter((c) => c !== initial.content)]) {
      for (const face of ordered) {
        const page = this.createPage(face, content, initial.scene)
        face.pages[content] = page
        showPage(page, content === this.content)
        this.enqueue(() => this.open(page, face), false)
      }
    }
  }

  get totalPages(): number {
    return this.faces.length * CONTENTS.length
  }

  setContent(content: Content): void {
    this.content = content
    for (const face of this.faces) {
      for (const page of Object.values(face.pages)) showPage(page, page.content === content)
    }
  }

  // The calm pages switch scene in place: /screen listens for this message and changes its route query,
  // so nothing reloads (田中 S-4 v2: a reload of 22 pages took 20 s at 10 fps).
  setScene(scene: AmbientScene): void {
    this.scene = scene
    for (const face of this.faces) {
      const page = face.pages.calm
      if (!page) continue
      page.scene = scene
      page.iframe.contentWindow?.postMessage({ type: 'evac-screen', scene }, SCREEN_ORIGIN)
    }
  }

  // Picks the smallest zoom whose backing store is at least the face's projected height on screen, and parks
  // the pages of faces turned away from the camera.
  updateZoom(camera: PerspectiveCamera, viewportHeightPx: number): void {
    const focalPx = viewportHeightPx / 2 / Math.tan((camera.fov * Math.PI) / 360)
    for (const face of this.faces) {
      toCamera.copy(camera.position).sub(face.hole.position)
      const distance = toCamera.length()
      const facing = toCamera.dot(faceNormal.set(...face.extras.normal)) > 0
      const projectedPx = (face.extras.size[1] * focalPx) / Math.max(distance, 0.01)
      const wanted = projectedPx / face.extras.face_px[1]
      const zoom = Math.min(ZOOM_LADDER.find((step) => step >= wanted) ?? 1, MAX_ZOOM[face.extras.shape])
      for (const page of Object.values(face.pages)) {
        if (zoom !== page.zoom) applyZoom(face, page, zoom)
        if (facing !== page.facing) {
          page.facing = facing
          showPage(page, page.shown)
        }
      }
    }
  }

  private createPage(face: Face, content: Content, scene: AmbientScene): Page {
    const { extras } = face
    const [pageWidth, pageHeight] = extras.face_px
    const box = document.createElement('div')
    box.style.overflow = 'hidden'
    const clip = document.createElement('div')
    clip.style.cssText = `width:${pageWidth}px;height:${pageHeight}px;overflow:hidden;position:relative;background:#000`
    box.appendChild(clip)
    const iframe = document.createElement('iframe')
    const ownPage = extras.shape !== 'pillar' || faceWindow(extras, content, this.crops) !== undefined
    iframe.style.cssText = `position:absolute;top:0;height:${pageHeight}px;width:${ownPage ? pageWidth : PILLAR_PAGE_WIDTH_PX}px;left:${ownPage ? 0 : -extras.face * pageWidth}px`
    clip.appendChild(iframe)
    const object = new CSS3DObject(box)
    object.position.copy(face.hole.position)
    object.quaternion.copy(face.hole.quaternion)
    this.stage.add(object)
    const page: Page = { content, scene, object, iframe, box, clip, zoom: 0, loaded: false, shown: false, facing: true }
    applyZoom(face, page, ZOOM_LADDER[0]!)
    return page
  }

  private async open(page: Page, face: Face): Promise<void> {
    page.iframe.src = screenUrl(face.extras, page.content, page.scene, this.crops)
    await loadedOrTimedOut(page.iframe)
    page.loaded = true
    showPage(page, page.shown)
    this.loadedPages += 1
    this.onProgress(this.loadedPages, this.totalPages)
  }


  private enqueue(task: () => Promise<void>, first: boolean): void {
    if (first) this.queue.unshift(task)
    else this.queue.push(task)
    this.pump()
  }

  private pump(): void {
    while (this.running < LOAD_CONCURRENCY && this.queue.length) {
      const task = this.queue.shift()!
      this.running += 1
      task().finally(() => {
        this.running -= 1
        this.pump()
      })
    }
  }
}

function applyZoom(face: Face, page: Page, zoom: number): void {
  const [pageWidth, pageHeight] = face.extras.face_px
  page.zoom = zoom
  page.clip.style.zoom = String(zoom)
  page.box.style.width = `${pageWidth * zoom}px`
  page.box.style.height = `${pageHeight * zoom}px`
  page.object.scale.setScalar(face.extras.size[0] / (pageWidth * zoom))
}
