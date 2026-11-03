import {
  EdgesGeometry, Group, LineBasicMaterial, LineSegments, Mesh, MeshBasicMaterial, MeshStandardMaterial, NoColorSpace,
  Object3D, PerspectiveCamera, Texture, TextureLoader,
} from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { isDisplayMesh } from './displays'

export type RenderMode = 'textured' | 'ao' | 'wire'

export interface RoomPiece {
  mesh: Mesh
  edges: LineSegments
  materials: Record<Exclude<RenderMode, 'wire'>, MeshBasicMaterial>
}

export interface Room {
  scene: Group
  pieces: RoomPiece[]
  displayMeshes: Mesh[]
  cameras: PerspectiveCamera[]
}

const EDGE_THRESHOLD_DEG = 20
const wireMaterial = new LineBasicMaterial({ color: 0xffffff })

async function loadAo(file: string): Promise<Texture> {
  const texture = await new TextureLoader().loadAsync(`/tex/${file}`)
  texture.flipY = false
  texture.colorSpace = NoColorSpace
  texture.channel = 0
  return texture
}

async function makePiece(mesh: Mesh): Promise<RoomPiece> {
  const baked = mesh.material as MeshStandardMaterial
  const aoMap = await loadAo(String(mesh.userData.ao))
  const materials = {
    textured: new MeshBasicMaterial({ map: baked.map, aoMap }),
    ao: new MeshBasicMaterial({ color: 0xffffff, aoMap }),
  }
  const edges = new LineSegments(new EdgesGeometry(mesh.geometry, EDGE_THRESHOLD_DEG), wireMaterial)
  edges.visible = false
  edges.applyMatrix4(mesh.matrix)
  mesh.parent!.add(edges)
  return { mesh, edges, materials }
}

export async function loadRoom(url: string): Promise<Room> {
  const gltf = await new GLTFLoader().loadAsync(url)
  const roomMeshes: Mesh[] = []
  const displayMeshes: Mesh[] = []
  gltf.scene.traverse((object: Object3D) => {
    if (isDisplayMesh(object)) displayMeshes.push(object)
    else if (object instanceof Mesh && typeof object.userData.ao === 'string') roomMeshes.push(object)
  })
  const pieces = await Promise.all(roomMeshes.map(makePiece))
  const cameras = gltf.cameras.filter((camera): camera is PerspectiveCamera => camera instanceof PerspectiveCamera)
  return { scene: gltf.scene, pieces, displayMeshes, cameras }
}

export function applyRenderMode(room: Room, mode: RenderMode): void {
  for (const piece of room.pieces) {
    piece.mesh.visible = mode !== 'wire'
    piece.edges.visible = mode === 'wire'
    if (mode !== 'wire') piece.mesh.material = piece.materials[mode]
  }
}
