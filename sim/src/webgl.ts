import { WebGLRenderer } from 'three'

export function webglAvailable(): boolean {
  const canvas = document.createElement('canvas')
  try {
    if (!canvas.getContext('webgl2') && !canvas.getContext('webgl')) throw new Error('no WebGL context')
    new WebGLRenderer({ canvas }).dispose()
    return true
  } catch (error) {
    console.warn('WebGL unavailable, showing the video link instead:', error)
    return false
  }
}
