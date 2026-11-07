import { webglAvailable } from './webgl'

if (webglAvailable()) void import('./sim')
else {
  document.getElementById('status')!.textContent = ''
  document.getElementById('nowebgl')!.hidden = false
}
