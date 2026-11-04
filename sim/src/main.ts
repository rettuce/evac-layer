import { PerspectiveCamera, Scene, WebGLRenderer } from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { CSS3DRenderer } from 'three/addons/renderers/CSS3DRenderer.js'
import { CameraRig, FILM_GAUGE_MM, presetsFromGltf } from './cameras'
import { createDisplay, setContent, updateZoom, type Display } from './displays'
import { applyRenderMode, loadRoom, type RenderMode } from './room'
import { loadCrops, type Content, type AmbientScene } from './screenUrl'
import { buildUi, fpsMeter } from './ui'

const INITIAL: { content: Content; scene: AmbientScene; mode: RenderMode; preset: string } = { content: 'calm', scene: 'brush-flow', mode: 'textured', preset: 'hero' }
const shown = { content: INITIAL.content, scene: INITIAL.scene }
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

const [room, crops] = await Promise.all([loadRoom('/room.glb'), loadCrops('/crops.json')])
scene.add(room.scene)
const displays: Display[] = room.displayMeshes.map((mesh) => createDisplay(mesh, INITIAL.content, INITIAL.scene, crops))
for (const display of displays) scene.add(display.object)
applyRenderMode(room, INITIAL.mode)

const presets = presetsFromGltf(room.cameras)
const first = presets.find((preset) => preset.name === INITIAL.preset) ?? presets[0]
if (first) rig.jumpTo(first)
status.textContent = `${room.pieces.length} pieces · ${displays.length} faces · ${presets.length} cameras`

buildUi(document.getElementById('ui')!, presets, INITIAL, {
  onContent: (content) => {
    shown.content = content
    setContent(displays, content, shown.scene, crops)
  },
  onScene: (scene) => {
    shown.scene = scene
    setContent(displays, shown.content, scene, crops)
  },
  onRenderMode: (mode) => applyRenderMode(room, mode),
  onCamera: (preset) => rig.flyTo(preset),
})

// Exposed for browser-side checks (camera flights, fps sampling) from DevTools or a test script.
Object.assign(window, { sim: { camera, controls, displays, room } })

const fps = fpsMeter(document.getElementById('fps')!)
let lastDrawMs = -Infinity
webgl.setAnimationLoop((nowMs) => {
  if (nowMs - lastDrawMs < MIN_FRAME_MS) return
  lastDrawMs = nowMs
  controls.update()
  updateZoom(displays, camera, innerHeight)
  webgl.render(scene, camera)
  css3d.render(scene, camera)
  fps(nowMs)
})
