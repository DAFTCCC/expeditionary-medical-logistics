import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { allowCameraSteps, detectInAppBrowser, detectPlatform } from '../src/app/camera';

const UA = {
  iosSafari: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
  iosChrome: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0 Mobile/15E148 Safari/604.1',
  iosWebview: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
  iosFacebook: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/490.0]',
  androidChrome: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36',
  androidWebview: 'Mozilla/5.0 (Linux; Android 14; Pixel 8; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/131.0 Mobile Safari/537.36',
  ipadDesktopMode: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15',
};

describe('camera environment detection', () => {
  it('real browsers are not flagged as in-app', () => {
    for (const k of ['iosSafari', 'iosChrome', 'androidChrome', 'ipadDesktopMode'] as const) assert.equal(detectInAppBrowser(UA[k]), null, k);
  });
  it('in-app browsers are flagged', () => {
    assert.equal(detectInAppBrowser(UA.iosFacebook), 'Facebook');
    assert.ok(detectInAppBrowser(UA.iosWebview));
    assert.ok(detectInAppBrowser(UA.androidWebview));
  });
  it('platform detection, including iPad in desktop mode', () => {
    assert.equal(detectPlatform(UA.iosSafari), 'ios');
    assert.equal(detectPlatform(UA.androidChrome), 'android');
    assert.equal(detectPlatform(UA.ipadDesktopMode, 5), 'ios');
    assert.equal(detectPlatform(UA.ipadDesktopMode, 0), 'desktop');
  });
  it('gives platform-specific steps to allow the camera', () => {
    assert.match(allowCameraSteps({ platform: 'ios', standalone: false }).join(' '), /Safari/);
    assert.match(allowCameraSteps({ platform: 'ios', standalone: true }).join(' '), /Settings app/);
    assert.match(allowCameraSteps({ platform: 'android', standalone: false }).join(' '), /Chrome/);
  });
});
