# Headless smoke test of the built canvas (web/dist): open /canvas, create a canvas, add a shot, set camera, press generate without a Key, open the Agent panel; prints console/page errors.
# Run: cd web && bun run build && python3 tests/e2e/smoke-canvas.py   (needs: pip install playwright==1.49.0; playwright install chromium)
import asyncio, threading, os, sys, http.server, socketserver, functools
from playwright.async_api import async_playwright
DIST = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "dist")
class H(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
    def send_head(self):
        p = self.translate_path(self.path.split('?')[0])
        if not os.path.exists(p) or (os.path.isdir(p) and not os.path.exists(os.path.join(p,'index.html'))):
            self.path = '/index.html'
        return super().send_head()
socketserver.ThreadingTCPServer.allow_reuse_address = True
srv = socketserver.ThreadingTCPServer(("127.0.0.1", 0), functools.partial(H, directory=DIST))
srv.daemon_threads = True
threading.Thread(target=srv.serve_forever, daemon=True).start()
PORT = srv.server_address[1]
BASE = f'http://127.0.0.1:{PORT}'
async def main():
    async with async_playwright() as p:
        from urllib.parse import urlparse
        raw = os.environ.get('HTTPS_PROXY') or os.environ.get('https_proxy') or os.environ.get('HTTP_PROXY') or os.environ.get('http_proxy')
        proxy = None
        if raw:
            u = urlparse(raw)
            proxy = {'server': f'{u.scheme}://{u.hostname}:{u.port}', 'bypass': '<-loopback>,127.0.0.1,localhost'}
            if u.username: proxy.update(username=u.username, password=u.password or '')
        b = await p.chromium.launch(args=['--no-sandbox'], proxy=proxy)
        pg = await b.new_page(viewport={'width':1440,'height':900}, ignore_https_errors=True)
        errs=[]
        pg.on('response', lambda r: errs.append(f'HTTP {r.status} {r.url}') if r.status >= 400 else None)
        pg.on('pageerror', lambda e: errs.append('pageerror: '+str(e)))
        pg.on('console', lambda m: errs.append(f'console.{m.type}: {m.text}') if m.type in ('error','warning') else None)
        await pg.goto(BASE + '/canvas'); await pg.wait_for_timeout(2500)
        await pg.screenshot(path='/tmp/hemosi-smoke-1-canvas-list.png')
        # create a project via the page button if present
        btns = await pg.locator('button').all_inner_texts()
        print('buttons:', [x for x in btns if x.strip()][:30])
        for label in sys.argv[1:]:
            pass
        target = None
        for t in ['新建画布','新建项目','新建','创建画布']:
            if await pg.get_by_text(t, exact=False).count():
                target = t; break
        if target:
            await pg.get_by_text(target, exact=False).first.click(); await pg.wait_for_timeout(3000)
        print('url:', pg.url)
        await pg.screenshot(path='/tmp/hemosi-smoke-2-project.png')
        await pg.mouse.click(1014, 852); await pg.wait_for_timeout(800)
        await pg.mouse.click(700, 400); await pg.wait_for_timeout(1200)
        await pg.screenshot(path='/tmp/hemosi-smoke-4-shot.png')
        boxes = await pg.evaluate("Array.from(document.querySelectorAll('svg')).filter(s => (s.getAttribute('class')||'').includes('clapper')).map(s => { const r = s.getBoundingClientRect(); return [s.getAttribute('class'), Math.round(r.x+r.width/2), Math.round(r.y+r.height/2)]; })")
        print('clapper svgs:', boxes)
        node_btn = [b for b in boxes if b[2] < 800]
        if node_btn:
            print('at point:', await pg.evaluate(f"(() => {{ const e = document.elementFromPoint({node_btn[-1][1]}, {node_btn[-1][2]}); return e ? e.outerHTML.slice(0,200) + ' | parent: ' + (e.closest('button')||{{outerHTML:''}}).outerHTML.slice(0,200) : null }})()"))
            await pg.locator('svg.lucide-clapperboard.size-3\\.5').locator('xpath=ancestor::button[1]').click(); await pg.wait_for_timeout(900)
            print('popover selects:', await pg.locator('.ant-popover .ant-select').count(), 'popovers:', await pg.locator('.ant-popover').count())
            await pg.screenshot(path='/tmp/hemosi-smoke-5-camera.png')
            # pick a focal length and a move, then verify metadata was stored on the node
            sel = pg.locator('.ant-popover .ant-select')
            await sel.nth(2).click(); await pg.wait_for_timeout(400)
            await pg.locator('.ant-select-dropdown:visible .ant-select-item-option').filter(has_text='35mm').first.click(); await pg.wait_for_timeout(400)
            await sel.nth(6).click(); await pg.wait_for_timeout(400)
            opts = pg.locator('.ant-select-dropdown:visible .ant-select-item-option')
            print('move options:', await opts.count())
            await opts.nth(1).click(); await pg.wait_for_timeout(600)
            print('popover text:', (await pg.locator('.ant-popover').first.inner_text())[:300].replace('\n',' | '))
            await pg.screenshot(path='/tmp/hemosi-smoke-6-camera-set.png')
        await pg.keyboard.press('Escape'); await pg.mouse.click(400, 700); await pg.wait_for_timeout(400)
        # type a description so the shot can run, then press 生成图片: no Key yet → explicit reason, no silent swap
        await pg.locator('textarea').first.fill('她在雨夜回头'); await pg.wait_for_timeout(300)
        await pg.get_by_text('生成图片', exact=True).first.click(); await pg.wait_for_timeout(1200)
        print('message:', await pg.locator('.ant-message').all_inner_texts())
        await pg.keyboard.press('Escape'); await pg.wait_for_timeout(400)
        await pg.get_by_text('Agent', exact=True).first.click(); await pg.wait_for_timeout(800)
        await pg.screenshot(path='/tmp/hemosi-smoke-3-agent.png')
        # open agent panel tab if exists
        if await pg.get_by_text('导演 Agent', exact=False).count():
            print('director tab visible')
        print('ERRORS:', len(errs))
        for e in errs: print(' ', e[:400])
        await b.close()
asyncio.run(main())
