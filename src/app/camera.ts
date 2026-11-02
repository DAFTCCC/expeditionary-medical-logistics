/**
 * Opening the camera and explaining, in plain words, why it will not open.
 * Kept separate from the decoder so the camera is requested straight from
 * the tap (before any code download), which some phone browsers require.
 */

export type Platform = 'ios' | 'android' | 'desktop';

export interface CameraEnv {
  platform: Platform;
  secure: boolean;
  hasApi: boolean;
  /** Opened inside another app's built-in browser (Facebook, Instagram, Gmail, LinkedIn, a chat app…). */
  inAppBrowser: string | null;
  standalone: boolean;
  permission: PermissionState | 'unknown';
}

export function detectInAppBrowser(ua: string): string | null {
  const known: [RegExp, string][] = [
    [/FBAN|FBAV|FB_IAB/i, 'Facebook'], [/Instagram/i, 'Instagram'], [/LinkedInApp/i, 'LinkedIn'],
    [/Line\//i, 'LINE'], [/Snapchat/i, 'Snapchat'], [/Twitter|TwitterAndroid/i, 'X/Twitter'],
    [/MicroMessenger/i, 'WeChat'], [/GSA\//i, 'the Google app'], [/; wv\)/i, 'an app'],
  ];
  for (const [re, name] of known) if (re.test(ua)) return name;
  // iOS in-app browsers usually lack "Safari/" while real Safari, Chrome (CriOS), Firefox (FxiOS) and Edge (EdgiOS) include it.
  if (/iPhone|iPad|iPod/.test(ua) && !/Safari\//.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua)) return 'an app';
  return null;
}

export function detectPlatform(ua: string, maxTouch = 0): Platform {
  if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && maxTouch > 1)) return 'ios';
  if (/Android/.test(ua)) return 'android';
  return 'desktop';
}

export async function cameraEnv(): Promise<CameraEnv> {
  const ua = navigator.userAgent;
  let permission: CameraEnv['permission'] = 'unknown';
  try {
    permission = (await navigator.permissions.query({ name: 'camera' as PermissionName })).state;
  } catch { /* not supported (older Safari) */ }
  return {
    platform: detectPlatform(ua, navigator.maxTouchPoints),
    secure: window.isSecureContext,
    hasApi: !!navigator.mediaDevices?.getUserMedia,
    inAppBrowser: detectInAppBrowser(ua),
    standalone: matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true,
    permission,
  };
}

/** Steps to turn the camera on for this site, by platform. */
export function allowCameraSteps(env: Pick<CameraEnv, 'platform' | 'standalone'>): string[] {
  if (env.platform === 'ios') {
    return env.standalone
      ? ['Open the iPhone Settings app → scroll to FieldLine (or Safari) → Camera → Allow.', 'Close FieldLine fully (swipe it away) and open it again.']
      : ['In Safari, tap the “aA” (or page-settings) button in the address bar → Website Settings → Camera → Allow.', 'Or: Settings app → Safari → Camera → Allow. Then reload this page.'];
  }
  if (env.platform === 'android') {
    return ['In Chrome, tap the icon left of the address (lock or sliders) → Permissions → Camera → Allow.', 'If it is still blocked: Android Settings → Apps → Chrome → Permissions → Camera → Allow. Then reload.'];
  }
  return ['Click the camera or lock icon in the address bar → allow the camera for this site, then reload.'];
}

export class CameraError extends Error {
  constructor(message: string, readonly kind: 'in-app' | 'insecure' | 'no-api' | 'denied' | 'no-camera' | 'busy' | 'other') {
    super(message);
  }
}

/** Request the rear camera. Call this directly from the tap handler. */
export async function openCamera(env: CameraEnv): Promise<MediaStream> {
  if (!env.secure) throw new CameraError('The camera only works on a secure (https) page.', 'insecure');
  if (!env.hasApi) {
    throw env.inAppBrowser
      ? new CameraError(`This page is open inside ${env.inAppBrowser}, whose built-in browser does not allow the camera.`, 'in-app')
      : new CameraError('This browser does not allow camera access from web pages.', 'no-api');
  }
  const attempts: MediaStreamConstraints[] = [
    { video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false },
    { video: { facingMode: 'environment' }, audio: false },
    { video: true, audio: false },
  ];
  let last: unknown;
  for (const c of attempts) {
    try {
      return await navigator.mediaDevices.getUserMedia(c);
    } catch (e) {
      last = e;
      const name = (e as DOMException).name;
      // Only retry with simpler settings when the settings were the problem.
      if (name !== 'OverconstrainedError' && name !== 'NotReadableError' && name !== 'AbortError') break;
    }
  }
  const name = (last as DOMException)?.name;
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    throw env.inAppBrowser
      ? new CameraError(`The camera was blocked inside ${env.inAppBrowser}.`, 'in-app')
      : new CameraError('Camera permission is blocked for this site.', 'denied');
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') throw new CameraError('No camera was found on this device.', 'no-camera');
  if (name === 'NotReadableError' || name === 'AbortError') throw new CameraError('The camera is busy — another app or browser tab may be using it. Close it and try again.', 'busy');
  throw new CameraError(`Could not start the camera (${name || (last as Error)?.message || 'unknown error'}).`, 'other');
}
