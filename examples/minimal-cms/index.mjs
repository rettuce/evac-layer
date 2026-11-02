import { createServer } from 'node:http'

const FEED = process.env.EVAC_FEED ?? 'http://127.0.0.1:3150/api/feed/05210-demo-honjo-station'
const SHAPE = process.env.SHAPE ?? '16x9'
const PORT = Number(process.env.PORT ?? 8080)
const POLL_MS = 2000

let etag = ''
let screen = { state: 'ambient' }

async function poll() {
  try {
    const res = await fetch(FEED, { headers: etag ? { 'If-None-Match': etag } : {} })
    if (res.status !== 200) return
    etag = res.headers.get('etag') ?? ''
    const feed = await res.json()
    const png = feed.assets[SHAPE]?.png
    screen = { state: feed.state, bulletin: feed.bulletin_id, image: png ? new URL(png, FEED).href : null }
    console.log(new Date().toISOString(), feed.state, feed.bulletin_id ?? '', screen.image ?? '')
  } catch (error) {
    console.error(`feed unreachable: ${error.message}`)
  }
}

const page = `<!doctype html><meta charset="utf-8"><title>minimal CMS</title>
<style>html,body{margin:0;height:100%;background:#222;color:#ddd;font:48px sans-serif}
#own{height:100%;display:grid;place-items:center}#alert{position:fixed;inset:0;width:100%;height:100%;object-fit:contain;background:#000;display:none}</style>
<div id="own">いつもの広告・お知らせ</div><img id="alert" alt="">
<script>setInterval(async () => {
  const s = await (await fetch('/state')).json(), img = document.getElementById('alert')
  if (s.state === 'alert' && s.image) { if (img.src !== s.image) img.src = s.image; img.style.display = 'block' } else img.style.display = 'none'
}, 1000)</script>`

createServer((req, res) => {
  if (req.url === '/state') return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(screen))
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(page)
}).listen(PORT, '127.0.0.1', () => console.log(`minimal CMS on http://127.0.0.1:${PORT} (feed ${FEED}, shape ${SHAPE})`))
setInterval(poll, POLL_MS)
poll()
