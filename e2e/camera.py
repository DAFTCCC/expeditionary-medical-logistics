"""Live-camera checks with Chrome's fake camera. Usage: python e2e/camera.py BASE_URL path/to/barcode.y4m
Make a .y4m from a barcode image: ffmpeg -loop 1 -i label.png -vf "scale=-2:300,pad=640:480:(ow-iw)/2:(oh-ih)/2:white,format=yuv420p" -t 3 -r 10 cam.y4m"""
import sys
from playwright.sync_api import sync_playwright
BASE, Y4M = sys.argv[1], sys.argv[2]
with sync_playwright() as pw:
    args = ['--no-sandbox', '--use-fake-device-for-media-stream', f'--use-file-for-fake-video-capture={Y4M}']
    # 1. permission granted, touch phone (camera should be the default tab)
    b = pw.chromium.launch(args=args + ['--use-fake-ui-for-media-stream'])
    ctx = b.new_context(permissions=['camera'], viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True)
    p = ctx.new_page(); errs = []; p.on('pageerror', lambda e: errs.append(str(e)))
    p.goto(BASE + '#/scan'); p.wait_for_selector('h1')
    print('default tab:', p.locator('button.tab.on').inner_text())
    p.click('button:has-text("Start camera")')
    p.wait_for_selector('.result', timeout=20000)
    print('granted →', p.locator('.result h2').inner_text(), '| errors:', errs)
    b.close()
    # 3. in-app browser (no camera API, webview user agent)
    b2 = pw.chromium.launch(args=args)
    c2 = b2.new_context(user_agent='Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/490.0]', viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True)
    c2.add_init_script("Object.defineProperty(navigator, 'mediaDevices', { get: () => undefined })")
    q = c2.new_page(); q.goto(BASE + '#/scan'); q.wait_for_selector('.cam-help', timeout=5000)
    print('in-app (before tapping) →', q.locator('.cam-help').first.inner_text().replace('\n', ' | ')[:220])
    q.screenshot(path=Y4M + '-inapp.png')
    b2.close()
    # 2. permission denied
    b = pw.chromium.launch(args=args)
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True)
    ctx.add_init_script("if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('denied', 'NotAllowedError'))")
    p = ctx.new_page(); p.goto(BASE + '#/scan'); p.wait_for_selector('h1'); p.wait_for_timeout(500)
    p.click('button:has-text("Start camera")')
    p.wait_for_selector('.cam-help', timeout=5000)
    print('denied →', p.locator('.cam-help').last.inner_text().replace('\n', ' | ')[:300])
    p.screenshot(path=Y4M + '-denied.png')
    b.close()
