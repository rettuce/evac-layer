import * as THREE from 'three'
import type { Shape } from '../../types'
import { sceneUnit } from '../field.ts'
import type { AmbientFrame, AmbientScene } from '../types'

// Luminous silt (2026-11-05, after rettuce.com/works/machinedrum/03.jpg and the radiant "Luminous Silt"
// sketch): thousands of short glowing strands carried by a curl-noise flow over a dark ground, every strand
// alive for a few seconds and replaced where it fades. Drawn with WebGL (three, one instanced quad per trail
// piece); every strand's path is integrated from its spawn point in the vertex shader, so a frame depends
// on t alone and tiles of one room agree.
const TRAIL_PIECES = 10
const TRAIL_PIECE_S = 0.1
const PARTICLES_PER_1080P = 24_000
const PARTICLES_MAX = 240_000
const STEPS = 24
const GROUND = new THREE.Color(0x0a0a0a)
const TEAL = [0.16, 0.67, 0.67] as const
const AMBER = [0.94, 0.59, 0.2] as const

const VERT = /* glsl */ `
uniform float uTime;
uniform float uSeed;
uniform vec2 uCanvas;
uniform vec4 uView;
uniform float uUnit;
uniform float uPieces;
out vec3 vColor;
out float vAlpha;

float hash1(float n) { return fract(sin(n) * 43758.5453123); }
vec4 hash4(float n) { return fract(sin(vec4(n, n + 1.0, n + 2.0, n + 3.0)) * 43758.5453123); }
float hash3d(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}
float vnoise3(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float n000 = hash3d(i);
  float n100 = hash3d(i + vec3(1, 0, 0));
  float n010 = hash3d(i + vec3(0, 1, 0));
  float n110 = hash3d(i + vec3(1, 1, 0));
  float n001 = hash3d(i + vec3(0, 0, 1));
  float n101 = hash3d(i + vec3(1, 0, 1));
  float n011 = hash3d(i + vec3(0, 1, 1));
  float n111 = hash3d(i + vec3(1, 1, 1));
  return mix(mix(mix(n000, n100, f.x), mix(n010, n110, f.x), f.y), mix(mix(n001, n101, f.x), mix(n011, n111, f.x), f.y), f.z);
}
vec2 curl(vec3 p) {
  float e = 0.02;
  float dy = vnoise3(p + vec3(0, e, 0)) - vnoise3(p - vec3(0, e, 0));
  float dx = vnoise3(p + vec3(e, 0, 0)) - vnoise3(p - vec3(e, 0, 0));
  return vec2(dy, -dx) / (2.0 * e);
}
vec2 advect(vec2 p, float age, float drift, float speed, float scale) {
  float dt = age / float(${STEPS});
  for (int k = 0; k < ${STEPS}; k++) {
    vec2 v = curl(vec3(p * scale, drift + uSeed * 0.001)) * speed;
    p += v * dt;
  }
  return p;
}
void collapse() { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vAlpha = 0.0; vColor = vec3(0.0); }
void main() {
  float id = float(gl_InstanceID);
  float pid = floor(id / uPieces);
  float piece = id - pid * uPieces;
  vec4 h = hash4(pid * 7.0 + uSeed);
  vec4 g = hash4(pid * 13.0 + 101.0 + uSeed);
  float life = mix(2.0, 5.0, h.x);
  float tsec = uTime / 1000.0;
  float phase = h.y * life;
  float age = mod(tsec + phase, life);
  float gen = floor((tsec + phase) / life);
  vec2 spawn = vec2(hash1(pid * 3.1 + gen * 17.0 + uSeed), hash1(pid * 5.7 + gen * 23.0 + uSeed * 0.7)) * uCanvas;
  float margin = 260.0 * uUnit;
  if (spawn.x < uView.x - margin || spawn.x > uView.x + uView.z + margin || spawn.y < uView.y - margin || spawn.y > uView.y + uView.w + margin) { collapse(); return; }
  float a1 = age - piece * ${TRAIL_PIECE_S};
  float a0 = a1 - ${TRAIL_PIECE_S};
  if (a0 < 0.0) { collapse(); return; }
  float drift = tsec / 40.0;
  float speed = mix(0.35, 1.0, g.x) * 60.0 * uUnit;
  float scale = 0.0032 / uUnit;
  vec2 p1 = advect(spawn, a1, drift, speed, scale);
  vec2 p0 = advect(spawn, a0, drift, speed, scale);
  vec2 d = p1 - p0;
  float len = length(d);
  if (len < 0.01) { collapse(); return; }
  vec2 dir = d / len;
  vec2 nrm = vec2(-dir.y, dir.x);
  float width = mix(1.2, 2.4, g.y) * uUnit;
  vec2 world = p0 + d * (position.x + 0.5) + nrm * position.y * width;
  vec2 ndc = ((world - uView.xy) / uView.zw) * 2.0 - 1.0;
  gl_Position = vec4(ndc.x, -ndc.y, 0.0, 1.0);
  float u = age / life;
  float envelope = smoothstep(0.0, 0.25, u) * (1.0 - smoothstep(0.7, 1.0, u));
  float tail = 1.0 - piece / uPieces;
  vAlpha = envelope * tail * mix(0.55, 1.0, g.z * g.z);
  vec2 n = world / uCanvas;
  vec3 teal = vec3(${TEAL[0]}, ${TEAL[1]}, ${TEAL[2]});
  vec3 amber = vec3(${AMBER[0]}, ${AMBER[1]}, ${AMBER[2]});
  vec3 col = mix(teal, amber, smoothstep(0.1, 0.9, n.x * 0.7 + n.y * 0.3 + (g.w - 0.5) * 0.3));
  col = mix(col, vec3(0.95, 0.92, 0.85), g.w > 0.95 ? 0.85 : 0.2);
  vColor = col;
}
`

const FRAG = /* glsl */ `
in vec3 vColor;
in float vAlpha;
out vec4 outColor;
void main() { outColor = vec4(vColor * vAlpha, 1.0); }
`

interface Gl {
  renderer: THREE.WebGLRenderer
  scene: THREE.Scene
  camera: THREE.Camera
  mesh: THREE.InstancedMesh
  material: THREE.ShaderMaterial
}

let gl: Gl | undefined

function setup(): Gl {
  const canvas = document.createElement('canvas')
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' })
  renderer.setPixelRatio(1)
  renderer.setClearColor(GROUND, 1)
  const material = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      uTime: { value: 0 },
      uSeed: { value: 0 },
      uCanvas: { value: new THREE.Vector2(1, 1) },
      uView: { value: new THREE.Vector4(0, 0, 1, 1) },
      uUnit: { value: 1 },
      uPieces: { value: TRAIL_PIECES },
    },
    // The y flip in the vertex shader mirrors the winding, so back-face culling would drop every quad.
    side: THREE.DoubleSide,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthTest: false,
    depthWrite: false,
  })
  const mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), material, PARTICLES_MAX * TRAIL_PIECES)
  mesh.frustumCulled = false
  const scene = new THREE.Scene()
  scene.add(mesh)
  const camera = new THREE.Camera()
  return { renderer, scene, camera, mesh, material }
}

function render(ctx: CanvasRenderingContext2D, t: number, seed: number, shape: Shape, frame: AmbientFrame): void {
  gl ??= setup()
  const { view } = frame
  const unit = sceneUnit(frame, shape)
  const particles = Math.min(PARTICLES_MAX, Math.round((PARTICLES_PER_1080P * frame.width * frame.height) / (1920 * 1080 * unit * unit)))
  const { renderer, material, mesh } = gl
  const width = Math.max(1, Math.round(view.width))
  const height = Math.max(1, Math.round(view.height))
  if (renderer.domElement.width !== width || renderer.domElement.height !== height) renderer.setSize(width, height, false)
  const u = material.uniforms
  u.uTime!.value = t % 86_400_000
  u.uSeed!.value = seed % 1000
  ;(u.uCanvas!.value as THREE.Vector2).set(frame.width, frame.height)
  ;(u.uView!.value as THREE.Vector4).set(view.x, view.y, view.width, view.height)
  u.uUnit!.value = unit
  mesh.count = particles * TRAIL_PIECES
  renderer.render(gl.scene, gl.camera)
  ctx.drawImage(renderer.domElement, view.x, view.y)
}

export const brushFlow: AmbientScene = { id: 'brush-flow', name: '筆の流れ', ink: 'light', render }
