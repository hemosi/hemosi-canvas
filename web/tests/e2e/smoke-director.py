# Headless click-through of the 3D director stage on the built canvas (web/dist):
# new canvas → 3D scene node → open stage → panorama backdrop → new camera → screenshot back → draw-to-video → record a move.
# Run: cd web && bun run build && python3 tests/e2e/smoke-director.py /path/to/panorama-2x1.png
import asyncio, threading, os, sys, http.server, socketserver, functools
from urllib.parse import urlparse
from playwright.async_api import async_playwright
DIST = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "dist")
class H(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
    def send_head(self):
        p = self.translate_path(self.path.split('?')[0])
        if not os.path.exists(p) or (os.path.isdir(p) and not os.path.exists(os.path.join(p, 'index.html'))):
            self.path = '/index.html'
        return super().send_head()
socketserver.ThreadingTCPServer.allow_reuse_address = True
srv = socketserver.ThreadingTCPServer(("127.0.0.1", 0), functools.partial(H, directory=DIST))
srv.daemon_threads = True
threading.Thread(target=srv.serve_forever, daemon=True).start()
BASE = f'http://127.0.0.1:{srv.server_address[1]}'
PANO = sys.argv[1] if len(sys.argv) > 1 else '/tmp/pano.png'

async def main():
    async with async_playwright() as p:
        raw = os.environ.get('HTTPS_PROXY') or os.environ.get('https_proxy')
        proxy = None
        if raw:
            u = urlparse(raw)
            proxy = {'server': f'{u.scheme}://{u.hostname}:{u.port}', 'bypass': '<-loopback>,127.0.0.1,localhost'}
            if u.username: proxy.update(username=u.username, password=u.password or '')
        b = await p.chromium.launch(args=['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'], proxy=proxy)
        pg = await b.new_page(viewport={'width': 1440, 'height': 900}, ignore_https_errors=True)
        errs = []
        pg.on('pageerror', lambda e: errs.append('pageerror: ' + str(e)))
        pg.on('console', lambda m: errs.append(f'console.{m.type}: {m.text}') if m.type == 'error' else None)
        step = lambda name: print('STEP', name, flush=True)
        async def msgs(): return [t for t in await pg.locator('.ant-message').all_inner_texts() if t.strip()]
        async def node_types(): return await pg.evaluate("Array.from(document.querySelectorAll('[data-node-type]')).map(e => e.getAttribute('data-node-type'))")
        await pg.goto(BASE + '/canvas'); await pg.wait_for_timeout(2500)
        for t in ['新建画布', '新建项目', '新建', '创建画布']:
            if await pg.get_by_text(t, exact=False).count():
                await pg.get_by_text(t, exact=False).first.click(); break
        await pg.wait_for_timeout(2500); step('canvas ' + pg.url)
        await pg.mouse.dblclick(700, 420); await pg.wait_for_timeout(800)
        await pg.get_by_text('3D 场景', exact=False).first.click(); await pg.wait_for_timeout(1500); step('3d node')
        await pg.get_by_text('打开导演台', exact=False).first.click(); await pg.wait_for_timeout(3000); step('stage open')
        await pg.locator('input[type=file]').last.set_input_files(PANO); await pg.wait_for_timeout(2000); step('panorama ' + str(await msgs()))
        await pg.get_by_text('+ 新机位', exact=False).first.locator('xpath=ancestor::div[contains(@class,"ant-select")][1]').click(); await pg.wait_for_timeout(500)
        await pg.locator('.ant-select-dropdown:visible .ant-select-item-option').first.click(); await pg.wait_for_timeout(800); step('camera')
        await pg.locator('[title^="以选定机位当前时刻截图"]').first.click(); await pg.wait_for_timeout(2500); step('shot ' + str(await msgs()))
        await pg.locator('[title^="截图并以它为首帧新建视频节点"]').first.click(); await pg.wait_for_timeout(2500); step('draw-to-video ' + str(await msgs()))
        await pg.locator('[title^="按选定机位的时长实时渲染并录制"]').first.click(); await pg.wait_for_timeout(9000); step('record ' + str(await msgs()))
        await pg.screenshot(path='/tmp/hemosi-director-stage.png')
        await pg.keyboard.press('Escape'); await pg.wait_for_timeout(1200)
        await pg.screenshot(path='/tmp/hemosi-director-canvas.png')
        print('node types:', await node_types())
        print('ERRORS:', len(errs))
        for e in errs: print(' ', e[:400])
        await b.close()
asyncio.run(main())
