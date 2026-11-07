import { PerspectiveCamera, Scene, WebGLRenderer } from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { CameraRig, FILM_GAUGE_MM, poseToQuery, presetFromQuery, presetsFromGltf } from './cameras'
import { Displays } from './displays'
import { applyRenderMode, loadRoom, type RenderMode } from './room'
import { SCENES, loadCrops, type AmbientScene, type Content } from './crops'
import { intro } from './intro'
import { loadPlaces, placeOf, type Places } from './places'
import { Timeline, renderNow } from './timeline'
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
// Render modes and copy pose are for making the demo, not for visitors: ?dev brings them back.
document.body.classList.toggle('dev', new URLSearchParams(location.search).has('dev'))
const nowBadge = document.getElementById('now')!
const introCard = document.getElementById('intro')!

const scene = new Scene()
const camera = new PerspectiveCamera(50, innerWidth / innerHeight, NEAR_M, FAR_M)
camera.filmGauge = FILM_GAUGE_MM

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
}
addEventListener('resize', resize)
resize()

const [room, crops] = await Promise.all([loadRoom(`${import.meta.env.BASE_URL}room.glb`), loadCrops(`${import.meta.env.BASE_URL}crops.json`)])
scene.add(room.scene)
applyRenderMode(room, INITIAL.mode)

// The four views the demo is judged on (田中 2026-11-05: hero, the wall, the headwall ribbon as in demo cut 8,
// the column); the glb still carries every still camera.
const SHOWN_CAMERAS: Record<string, string> = { hero: 'hero', 'wall-final': 'wall-final', 'rib-final': 'rib-final', 'col-final': 'col-final' }
const presets = presetsFromGltf(room.cameras)
  .filter((preset) => preset.name in SHOWN_CAMERAS)
  .map((preset) => ({ ...preset, name: SHOWN_CAMERAS[preset.name]! }))
  .sort((a, b) => Object.values(SHOWN_CAMERAS).indexOf(a.name) - Object.values(SHOWN_CAMERAS).indexOf(b.name))
// hero2: 田中's own pose of 2026-11-05 (copy pose), not a Blender camera.
const HERO2 = presetFromQuery('hero2', '3.32,1.24,8.33,-0.91,2.81,-8.69,28')!
presets.splice(1, 0, HERO2)
const pinned = presetFromQuery('cam', new URLSearchParams(location.search).get('cam'))
const first = pinned ?? presets.find((preset) => preset.name === INITIAL.preset) ?? presets[0]
if (first) rig.jumpTo(first)

const displays = new Displays(room.displayMeshes, crops, INITIAL)
status.textContent = 'loading video …'

let places: Places | undefined
function showState(setId: string | undefined): void {
  renderNow(nowBadge, setId, setId ? displays.setById(setId) : undefined)
  places?.show(placeOf(setId))
}
const timeline = new Timeline(document.getElementById('timeline')!, {
  onShow: (setId) => {
    displays.showSet(setId)
    ui.showContent(setId ? 'evac' : 'calm')
    showState(setId)
  },
})
showState(undefined)
void loadPlaces(document.getElementById('places')!, (setId) => timeline.showVariant(setId)).then((loaded) => {
  places = loaded
  showState(displays.content === 'evac' ? displays.alertSet?.id : undefined)
})

const ui = buildUi(document.getElementById('ui')!, presets, INITIAL, {
  onContent: (content) => {
    if (content === 'calm') {
      timeline.pause()
      timeline.jump(0)
      return
    }
    timeline.jump(timeline.firstAlertStep)
    timeline.play()
  },
  onScene: (ambientScene) => { void displays.setScene(ambientScene) },
  onRenderMode: (mode) => applyRenderMode(room, mode),
  onCamera: (preset) => rig.flyTo(preset),
  onCopyCamera: () => {
    const query = `?cam=${poseToQuery(camera, controls)}`
    console.log(query)
    void navigator.clipboard?.writeText(query)
  },
})

for (const ambientScene of SCENES) {
  void displays.hasVideo(ambientScene).then((available) => ui.setSceneAvailable(ambientScene, available))
}

// [D] leaves only the room and its screens (田中 S-R1 5).
const debugPanels = ['ui', 'now', 'dock', 'info', 'panel-toggle'].map((id) => document.getElementById(id)!)
let debugShown = true
// Steps over scenes whose loop is missing; the scene also changes under EVAC LAYER, for when it comes back.
function stepScene(direction: 1 | -1): void {
  const index = SCENES.indexOf(ui.scene)
  for (let step = 1; step < SCENES.length; step++) {
    const candidate = SCENES[(index + direction * step + SCENES.length * step) % SCENES.length]!
    if (ui.isSceneAvailable(candidate)) {
      ui.pickScene(candidate)
      return
    }
  }
}
// [E] keeps the random set of S-14 beside the timeline: the timeline stops and lets go of the faces.
function toggleRandomAlert(): void {
  timeline.release()
  if (ui.content === 'calm') displays.setContent('evac')
  else displays.showSet(undefined)
  ui.showContent(displays.content)
  showState(displays.content === 'evac' ? displays.alertSet?.id : undefined)
}
document.getElementById('panel-toggle')!.addEventListener('click', () => document.body.classList.toggle('panel-open'))
addEventListener('keydown', (event) => {
  if (event.metaKey || event.ctrlKey || event.altKey || !introCard.hidden) return
  switch (event.key) {
    case 'd':
    case 'D':
      debugShown = !debugShown
      for (const panel of debugPanels) panel.style.display = debugShown ? '' : 'none'
      break
    case 'e':
    case 'E':
      toggleRandomAlert()
      break
    case 'ArrowRight':
      stepScene(1)
      break
    case 'ArrowLeft':
      stepScene(-1)
      break
  }
})
const ready = displays.hasVideo(INITIAL.scene).then(async (available) => {
  if (!available) {
    status.textContent = `video not found: ${displays.videoUrl(INITIAL.scene)}`
    return false
  }
  try {
    await displays.start()
    status.textContent = ''
    return true
  } catch (error) {
    status.textContent = String(error)
    return false
  }
})
void Promise.all([ready, intro(introCard)]).then(([started]) => {
  if (started) timeline.play()
})

// Measurement switches for DevTools (S-4 v2): uncapped draws, WebGL off, and the last loop times.
const perf = { cap: true, webgl: true, drawMs: [] as number[], loopMs: [] as number[] }
Object.assign(window, { sim: { camera, controls, displays, room, webgl, perf, timeline } })

const fps = fpsMeter(document.getElementById('fps')!)
let lastDrawMs = -Infinity
webgl.setAnimationLoop((nowMs) => {
  if (perf.cap && nowMs - lastDrawMs < MIN_FRAME_MS) return
  if (perf.drawMs.length < 600) perf.drawMs.push(nowMs - lastDrawMs)
  lastDrawMs = nowMs
  const started = performance.now()
  controls.update()
  timeline.tick(nowMs)
  displays.update()
  if (perf.webgl) webgl.render(scene, camera)
  if (perf.loopMs.length < 600) perf.loopMs.push(performance.now() - started)
  fps(nowMs)
})
