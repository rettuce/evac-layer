import json, os, threading, time, urllib.error, urllib.parse, urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

FEED = os.environ.get('EVAC_FEED', 'http://127.0.0.1:3150/api/feed/05210-demo-honjo-station')
SHAPE = os.environ.get('SHAPE', '16x9')
PORT = int(os.environ.get('PORT', '8091'))
POLL_S = 2

screen = {'state': 'ambient'}

def poll_forever():
    global screen
    etag = ''
    while True:
        try:
            req = urllib.request.Request(FEED, headers={'If-None-Match': etag} if etag else {})
            with urllib.request.urlopen(req, timeout=5) as res:
                etag = res.headers.get('ETag', '')
                feed = json.load(res)
            png = (feed['assets'].get(SHAPE) or {}).get('png')
            screen = {'state': feed['state'], 'bulletin': feed['bulletin_id'], 'image': urllib.parse.urljoin(FEED, png) if png else None}
            print(time.strftime('%H:%M:%S'), feed['state'], feed['bulletin_id'] or '', screen['image'] or '', flush=True)
        except urllib.error.HTTPError as error:
            if error.code != 304: print(f'feed {error.code}: {FEED}', flush=True)
        except (urllib.error.URLError, OSError) as error:
            print(f'feed unreachable: {error}', flush=True)
        time.sleep(POLL_S)

PAGE = '''<!doctype html><meta charset="utf-8"><title>python player</title>
<style>html,body{margin:0;height:100%;background:#f4f1ea;color:#1b1b1b;font:28px sans-serif}
main{padding:10vh 6vw 0}h1{margin:0 0 3vh;font-size:56px;border-bottom:6px solid #e0592a}
table{width:100%;border-collapse:collapse}td{padding:1.3vh 0;border-bottom:2px solid #d8d2c4}td:last-child{text-align:right}
.t{font:bold 40px monospace;color:#e0592a;width:16%}#alert{position:fixed;inset:0;width:100%;height:100%;object-fit:contain;background:#000;display:none}</style>
<main><h1>駅前モール 店舗・交通案内</h1><table>
<tr><td class="t">18:20</td><td>本荘駅前 発 市内循環バス</td><td>2 番のりば</td></tr>
<tr><td class="t">18:32</td><td>羽後本荘 発 普通列車</td><td>1 番線</td></tr>
<tr><td class="t">10:00</td><td>ベーカリー 小麦堂</td><td>1F 営業中</td></tr>
<tr><td class="t">11:00</td><td>喫茶 こよし</td><td>2F 営業中</td></tr>
<tr><td class="t">10:00</td><td>文具 あおば</td><td>2F 営業中</td></tr></table></main><img id="alert" alt="">
<script>setInterval(async () => {
  const s = await (await fetch('/state')).json(), img = document.getElementById('alert')
  if (s.state === 'alert' && s.image) { if (img.src !== s.image) img.src = s.image; img.style.display = 'block' } else img.style.display = 'none'
}, 1000)</script>'''

class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        body, kind = (json.dumps(screen), 'application/json') if self.path == '/state' else (PAGE, 'text/html; charset=utf-8')
        self.send_response(200); self.send_header('content-type', kind); self.end_headers(); self.wfile.write(body.encode())
    def log_message(self, *args): pass

threading.Thread(target=poll_forever, daemon=True).start()
print(f'python player on http://127.0.0.1:{PORT} (feed {FEED}, shape {SHAPE})', flush=True)
ThreadingHTTPServer(('127.0.0.1', PORT), Handler).serve_forever()
