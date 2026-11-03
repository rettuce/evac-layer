import { Mesh, MeshBasicMaterial, NoBlending, Object3D, Vector3 } from 'three'
import { CSS3DObject } from 'three/addons/renderers/CSS3DRenderer.js'
import { screenUrl, type Content, type CropsFile, type DisplayExtras } from './screenUrl'

// The pillar page lays its four faces side by side; a face iframe shows one quarter of it.
const PILLAR_PAGE_WIDTH_PX = 6616

// Writes depth and clears colour, so the room in front hides the page and the page shows through from below.
export const holeMaterial = new MeshBasicMaterial({ color: 0x000000, blending: NoBlending, opacity: 0, premultipliedAlpha: true })

export interface Display {
  mesh: Mesh
  extras: DisplayExtras
  object: CSS3DObject
  iframe: HTMLIFrameElement
}

export function isDisplayMesh(object: Object3D): object is Mesh {
  return object instanceof Mesh && typeof object.userData.screen === 'string'
}

export function createDisplay(mesh: Mesh, content: Content, crops?: CropsFile): Display {
  const extras = mesh.userData as DisplayExtras
  mesh.material = holeMaterial
  const [pageWidth, pageHeight] = extras.face_px
  const clip = document.createElement('div')
  clip.style.cssText = `width:${pageWidth}px;height:${pageHeight}px;overflow:hidden;position:relative;background:#000`
  const iframe = document.createElement('iframe')
  const iframeWidth = extras.shape === 'pillar' ? PILLAR_PAGE_WIDTH_PX : pageWidth
  iframe.style.cssText = `position:absolute;top:0;left:${-extras.face * pageWidth}px;width:${iframeWidth}px;height:${pageHeight}px`
  iframe.src = screenUrl(extras, content, crops)
  clip.appendChild(iframe)

  const object = new CSS3DObject(clip)
  const center = new Vector3(...extras.center)
  const normal = new Vector3(...extras.normal)
  object.position.copy(center)
  object.lookAt(center.clone().add(normal))
  object.scale.setScalar(extras.size[0] / pageWidth)
  return { mesh, extras, object, iframe }
}

export function setContent(displays: Display[], content: Content, crops?: CropsFile): void {
  for (const display of displays) display.iframe.src = screenUrl(display.extras, content, crops)
}
