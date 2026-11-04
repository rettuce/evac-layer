import { PerspectiveCamera, Scene, WebGLRenderer } from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { CSS3DRenderer } from 'three/addons/renderers/CSS3DRenderer.js'
import { CameraRig, FILM_GAUGE_MM, poseToQuery, presetFromQuery, presetsFromGltf } from './cameras'
import { Displays } from './displays'
import { applyRenderMode, loadRoom, type RenderMode } from './room'
import { loadCrops, type AmbientScene, type Content } from './screenUrl'
import { buildUi, fpsMeter } from './ui'

const INITIAL: { content: Content; scene: AmbientScene; mode: RenderMode; preset: string } = { content: 'calm', scene: 'brush-flow', mode: 'textured', preset: 'hero' }
const NEAR_M = 0.05
const FAR_M = 100
// Frames are skipped so a 120 Hz display still draws 60 per second; the half-millisecond keeps vsync jitter on
// a 120 Hz screen from dropping every third frame (田中 S-2 2026-11-04). Camera flights run on real time.
const MAX_FPS = 60
const MIN_FRAME_MS = 1000 / MAX_FPS - 0.5

const stage = document.getElementById('stage')!
const status = document.getElementById('status')!

const scene = new Scene()
const camera = new PerspectiveCamera(50, innerWidth / innerHeight, NEAR_M, FAR_M)
camera.filmGauge = FILM_GAUGE_MM

const css3d = new CSS3DRenderer()
css3d.domElement.className = 'css3d'
stage.appendChild(css3d.domElement)

const webgl = new WebGLRenderer({ antialias: true, alpha: true })
webgl.setPixelRatio(Math.min(devicePixelRatio, 2))
webgl.setClearColor(0x000000, 0)
stage.appendChild(webgl.domElement)

const controls = new OrbitControls(camera, stage)
controls.enableDamping = true
controls.dampingFactor = 0.1
const rig = new CameraRig(camera, controls)

function resize() {
  camera.aspect = innerWidth / innerHeight
  camera.updateProjectionMatrix()
  webgl.setSize(innerWidth, innerHeight)
  css3d.setSize(innerWidth, innerHeight)
}
addEventListener('resize', resize)
resize()

const [room, crops] = await Promise.all([loadRoom(`${import.meta.env.BASE_URL}room.glb`), loadCrops(`${import.meta.env.BASE_URL}crops.json`)])
scene.add(room.scene)
applyRenderMode(room, INITIAL.mode)

// The four views the demo is judged on (田中 2026-11-05: hero, the wall, the headwall ribbon as in demo cut 8,
// the column); the glb still carries every still camera.
const SHOWN_CAMERAS: Record<string, string> = { hero: 'hero', 'wall-final': 'wall-final', 'rib-final': 'rib-final', 'col-final': 'col-final' }
// hero2: 田中's view of 2026-11-05 (a long lens from the back of the room: the near columns at both edges, the three
// wall screens centred, the louver ceiling in the top third), fitted by hand; not a Blender camera.
const HERO2 = presetFromQuery('hero2', '0.80,1.10,11.50,0.20,2.60,-9.00,29')!
const presets = presetsFromGltf(room.cameras)
  .filter((preset) => preset.name in SHOWN_CAMERAS)
  .map((preset) => ({ ...preset, name: SHOWN_CAMERAS[preset.name]! }))
  .sort((a, b) => Object.values(SHOWN_CAMERAS).indexOf(a.name) - Object.values(SHOWN_CAMERAS).indexOf(b.name))
presets.splice(1, 0, HERO2)
const pinned = presetFromQuery('cam', new URLSearchParams(location.search).get('cam'))
const first = pinned ?? presets.find((preset) => preset.name === INITIAL.preset) ?? presets[0]
if (first) rig.jumpTo(first)

const displays = new Displays(scene, room.displayMeshes, crops, INITIAL, camera)
const summary = `${room.pieces.length} pieces · ${displays.faces.length} faces · ${presets.length} cameras`
status.textContent = `${summary} · loading pages 0/${displays.totalPages}`
displays.onProgress = (loaded, total) => {
  status.textContent = loaded < total ? `${summary} · loading pages ${loaded}/${total}` : summary
}

buildUi(document.getElementById('ui')!, presets, INITIAL, {
  onContent: (content) => displays.setContent(content),
  onScene: (ambientScene) => displays.setScene(ambientScene),
  onRenderMode: (mode) => applyRenderMode(room, mode),
  onCamera: (preset) => rig.flyTo(preset),
  onCopyCamera: () => {
    const query = `?cam=${poseToQuery(camera, controls)}`
    console.log(query)
    void navigator.clipboard?.writeText(query)
  },
})

// Measurement switches for DevTools (S-4 v2): uncapped draws, WebGL off, and the last loop times.
const perf = { cap: true, webgl: true, drawMs: [] as number[], loopMs: [] as number[] }
Object.assign(window, { sim: { camera, controls, displays, room, webgl, perf } })

const fps = fpsMeter(document.getElementById('fps')!)
let lastDrawMs = -Infinity
webgl.setAnimationLoop((nowMs) => {
  if (perf.cap && nowMs - lastDrawMs < MIN_FRAME_MS) return
  if (perf.drawMs.length < 600) perf.drawMs.push(nowMs - lastDrawMs)
  lastDrawMs = nowMs
  const started = performance.now()
  controls.update()
  displays.updateZoom(camera, innerHeight)
  if (perf.webgl) webgl.render(scene, camera)
  css3d.render(scene, camera)
  if (perf.loopMs.length < 600) perf.loopMs.push(performance.now() - started)
  fps(nowMs)
})
