import type { CameraPreset } from './cameras'
import type { RenderMode } from './room'
import { SCENES, type Content, type AmbientScene } from './screenUrl'

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

function radioButtons<T extends string>(parent: HTMLElement, options: [T, string][], initial: T, onPick: (value: T) => void): HTMLButtonElement[] {
  const buttons = new Map<T, HTMLButtonElement>()
  const select = (value: T) => {
    for (const [key, button] of buttons) button.setAttribute('aria-pressed', String(key === value))
  }
  for (const [value, label] of options) {
    const button = document.createElement('button')
    button.textContent = label
    button.addEventListener('click', () => {
      select(value)
      onPick(value)
    })
    buttons.set(value, button)
    parent.appendChild(button)
  }
  select(initial)
  return [...buttons.values()]
}

export function buildUi(root: HTMLElement, presets: CameraPreset[], initial: { content: Content; scene: AmbientScene; mode: RenderMode }, handlers: UiHandlers): void {
  const sceneButtons: HTMLButtonElement[] = []
  const enableScenes = (content: Content) => {
    for (const button of sceneButtons) button.disabled = content !== 'calm'
  }
  radioButtons(group(root, 'content'), CONTENTS, initial.content, (content) => {
    enableScenes(content)
    handlers.onContent(content)
  })
  sceneButtons.push(...radioButtons(group(root, 'ambient scene (平常時)'), SCENES.map((id) => [id, id]), initial.scene, handlers.onScene))
  enableScenes(initial.content)
  radioButtons(group(root, 'render'), RENDER_MODES, initial.mode, handlers.onRenderMode)
  const cameras = group(root, 'camera')
  for (const preset of presets) {
    const button = document.createElement('button')
    button.textContent = preset.name
    button.addEventListener('click', () => handlers.onCamera(preset))
    cameras.appendChild(button)
  }
  const copy = document.createElement('button')
  copy.textContent = 'copy pose'
  copy.title = 'copies ?cam=… for this view to the clipboard and the console'
  copy.addEventListener('click', handlers.onCopyCamera)
  cameras.appendChild(copy)
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
