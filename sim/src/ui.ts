import type { CameraPreset } from './cameras'
import type { RenderMode } from './room'
import { SCENES, type Content, type AmbientScene } from './crops'

export interface UiHandlers {
  onContent: (content: Content) => void
  onScene: (scene: AmbientScene) => void
  onRenderMode: (mode: RenderMode) => void
  onCamera: (preset: CameraPreset) => void
  onCopyCamera: () => void
}

const CONTENTS: [Content, string][] = [['calm', '平常時'], ['evac', 'EVAC LAYER']]
const RENDER_MODES: [RenderMode, string][] = [['textured', 'Textured'], ['ao', 'AO'], ['wire', 'Wire']]

function group(root: HTMLElement, title: string): HTMLElement {
  const element = document.createElement('div')
  element.className = 'group'
  const heading = document.createElement('h2')
  heading.textContent = title
  element.appendChild(heading)
  root.appendChild(element)
  return element
}

interface Radio<T extends string> {
  buttons: HTMLButtonElement[]
  pick: (value: T) => void
}

function radioButtons<T extends string>(parent: HTMLElement, options: [T, string][], initial: T, onPick: (value: T) => void): Radio<T> {
  const buttons = new Map<T, HTMLButtonElement>()
  const select = (value: T) => {
    for (const [key, button] of buttons) button.setAttribute('aria-pressed', String(key === value))
  }
  const pick = (value: T) => {
    select(value)
    onPick(value)
  }
  for (const [value, label] of options) {
    const button = document.createElement('button')
    button.textContent = label
    button.addEventListener('click', () => pick(value))
    buttons.set(value, button)
    parent.appendChild(button)
  }
  select(initial)
  return { buttons: [...buttons.values()], pick }
}

export interface Ui {
  readonly content: Content
  readonly scene: AmbientScene
  // The keyboard goes through the same path as a click, so the pressed button follows.
  pickContent: (content: Content) => void
  pickScene: (scene: AmbientScene) => void
  isSceneAvailable: (scene: AmbientScene) => boolean
  setSceneAvailable: (scene: AmbientScene, available: boolean) => void
}

export function buildUi(root: HTMLElement, presets: CameraPreset[], initial: { content: Content; scene: AmbientScene; mode: RenderMode }, handlers: UiHandlers): Ui {
  const missing = new Set<AmbientScene>()
  const current = { content: initial.content, scene: initial.scene }
  let sceneButtons: HTMLButtonElement[] = []
  const enableScenes = () => {
    sceneButtons.forEach((button, index) => {
      const scene = SCENES[index]!
      button.disabled = current.content !== 'calm' || missing.has(scene)
      button.title = missing.has(scene) ? '動画未配置' : ''
    })
  }
  const contents = radioButtons(group(root, 'content'), CONTENTS, initial.content, (content) => {
    current.content = content
    enableScenes()
    handlers.onContent(content)
  })
  const scenes = radioButtons(group(root, 'ambient scene (平常時)'), SCENES.map((id) => [id, id]), initial.scene, (scene) => {
    current.scene = scene
    handlers.onScene(scene)
  })
  sceneButtons = scenes.buttons
  enableScenes()
  radioButtons(group(root, 'render'), RENDER_MODES, initial.mode, handlers.onRenderMode)
  const cameras = group(root, 'camera')
  for (const preset of presets) {
    const button = document.createElement('button')
    button.textContent = preset.name.replace(/-final$/, '')
    button.addEventListener('click', () => handlers.onCamera(preset))
    cameras.appendChild(button)
  }
  const copy = document.createElement('button')
  copy.textContent = 'copy pose'
  copy.title = 'copies ?cam=… for this view to the clipboard and the console'
  copy.addEventListener('click', handlers.onCopyCamera)
  cameras.appendChild(copy)
  return {
    get content() {
      return current.content
    },
    get scene() {
      return current.scene
    },
    pickContent: contents.pick,
    pickScene: scenes.pick,
    isSceneAvailable: (scene) => !missing.has(scene),
    setSceneAvailable: (scene, available) => {
      if (available) missing.delete(scene)
      else missing.add(scene)
      enableScenes()
    },
  }
}

export function fpsMeter(element: HTMLElement): (nowMs: number) => void {
  let frames = 0
  let windowStart = performance.now()
  return (nowMs) => {
    frames += 1
    const elapsed = nowMs - windowStart
    if (elapsed < 500) return
    element.textContent = `${((frames * 1000) / elapsed).toFixed(0)} fps`
    frames = 0
    windowStart = nowMs
  }
}
