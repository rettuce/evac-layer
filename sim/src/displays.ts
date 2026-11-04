import { Mesh, MeshBasicMaterial, NoBlending, Object3D, PerspectiveCamera, PlaneGeometry, Vector3 } from 'three'
import { CSS3DObject } from 'three/addons/renderers/CSS3DRenderer.js'
import { faceWindow, screenUrl, type Content, type CropsFile, type DisplayExtras, type AmbientScene } from './screenUrl'

// The pillar page lays its four faces side by side; a face iframe shows one quarter of it.
const PILLAR_PAGE_WIDTH_PX = 6616
// CSS zoom lowers the devicePixelRatio the page sees, so its canvas is rastered at about the size it has on
// screen: 16 pillar faces (6616x5046 each) at zoom 1 ran at 6 fps, and a page rastered far larger than it is
// drawn was left partly unpainted (black bands) by the compositor; the ladder keeps the backing store within
// one step of the projected size (measured 2026-11-04). The pillar page is capped because four of its faces
// are rastered per column.
const ZOOM_LADDER = [0.125, 0.25, 0.5, 1]
const MAX_ZOOM: Record<DisplayExtras['shape'], number> = { pillar: 0.5, '9x16': 1, '32x9': 1 }

// Writes depth and clears colour, so the room in front hides the page and the page shows through from below.
// The bezel plane sits 0.5 mm behind the face, which z-fights from a few metres away without the offset.
export const holeMaterial = new MeshBasicMaterial({
  color: 0x000000, blending: NoBlending, opacity: 0, premultipliedAlpha: true,
  polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
})

export interface Display {
  // The depth-only quad: the same rectangle as the CSS3D plane, so no part of the hole lacks a page behind it
  // (the glb's curved LED wrap as the hole left the column corners uncovered: S-2, 2026-11-04).
  hole: Mesh
  extras: DisplayExtras
  object: CSS3DObject
  iframe: HTMLIFrameElement
  box: HTMLDivElement
  clip: HTMLDivElement
  zoom: number
}

export function isDisplayMesh(object: Object3D): object is Mesh {
  return object instanceof Mesh && typeof object.userData.screen === 'string'
}

export function createDisplay(mesh: Mesh, content: Content, scene: AmbientScene, crops?: CropsFile): Display {
  const extras = mesh.userData as DisplayExtras
  mesh.visible = false
  const [pageWidth, pageHeight] = extras.face_px
  const box = document.createElement('div')
  box.style.overflow = 'hidden'
  const clip = document.createElement('div')
  clip.style.cssText = `width:${pageWidth}px;height:${pageHeight}px;overflow:hidden;position:relative;background:#000`
  box.appendChild(clip)
  const iframe = document.createElement('iframe')
  iframe.style.cssText = `position:absolute;top:0;height:${pageHeight}px`
  clip.appendChild(iframe)

  const object = new CSS3DObject(box)
  const center = new Vector3(...extras.center)
  const normal = new Vector3(...extras.normal)
  object.position.copy(center)
  object.lookAt(center.clone().add(normal))
  const hole = new Mesh(new PlaneGeometry(extras.size[0], extras.size[1]), holeMaterial)
  hole.position.copy(center)
  hole.lookAt(center.clone().add(normal))
  mesh.parent!.add(hole)
  const display: Display = { hole, extras, object, iframe, box, clip, zoom: 0 }
  applyZoom(display, ZOOM_LADDER[0]!)
  showPage(display, content, scene, crops)
  return display
}

// A pillar face shows its quarter of the column's page, except when it has a page of its own (calm faces).
function showPage(display: Display, content: Content, scene: AmbientScene, crops?: CropsFile): void {
  const { extras, iframe } = display
  const [pageWidth] = extras.face_px
  const ownPage = extras.shape !== 'pillar' || faceWindow(extras, content, crops) !== undefined
  iframe.style.width = `${ownPage ? pageWidth : PILLAR_PAGE_WIDTH_PX}px`
  iframe.style.left = `${ownPage ? 0 : -extras.face * pageWidth}px`
  iframe.src = screenUrl(extras, content, scene, crops)
}

function applyZoom(display: Display, zoom: number): void {
  const [pageWidth, pageHeight] = display.extras.face_px
  display.zoom = zoom
  display.clip.style.zoom = String(zoom)
  display.box.style.width = `${pageWidth * zoom}px`
  display.box.style.height = `${pageHeight * zoom}px`
  display.object.scale.setScalar(display.extras.size[0] / (pageWidth * zoom))
}

const toCamera = new Vector3()

// Picks the smallest zoom whose backing store is at least the face's projected height on screen.
export function updateZoom(displays: Display[], camera: PerspectiveCamera, viewportHeightPx: number): void {
  const focalPx = viewportHeightPx / 2 / Math.tan((camera.fov * Math.PI) / 360)
  for (const display of displays) {
    const distance = toCamera.copy(display.object.position).sub(camera.position).length()
    const projectedPx = (display.extras.size[1] * focalPx) / Math.max(distance, 0.01)
    const wanted = projectedPx / display.extras.face_px[1]
    const zoom = ZOOM_LADDER.find((step) => step >= wanted) ?? 1
    const capped = Math.min(zoom, MAX_ZOOM[display.extras.shape])
    if (capped !== display.zoom) applyZoom(display, capped)
  }
}

export function setContent(displays: Display[], content: Content, scene: AmbientScene, crops?: CropsFile): void {
  for (const display of displays) showPage(display, content, scene, crops)
}
