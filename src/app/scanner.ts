import { BarcodeDetector, prepareZXingModule, type BarcodeFormat } from 'barcode-detector/ponyfill';
import wasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url';

/**
 * Camera barcode decoding via the BarcodeDetector ponyfill backed by
 * zxing-wasm (ADR-006). The WASM file is bundled with the app instead of
 * loaded from a CDN, so scanning keeps working without connectivity once
 * the page is cached.
 */
prepareZXingModule({
  overrides: {
    locateFile: (path: string, prefix: string) => (path.endsWith('.wasm') ? wasmUrl : prefix + path),
  },
});

export const SCAN_FORMATS: BarcodeFormat[] = ['qr_code', 'data_matrix', 'code_128', 'ean_13', 'upc_a', 'ean_8', 'upc_e', 'code_39'];

let detector: BarcodeDetector | undefined;
function getDetector(): BarcodeDetector {
  return (detector ??= new BarcodeDetector({ formats: SCAN_FORMATS }));
}

export interface Detected { raw: string; format: string }

export async function detectIn(source: ImageBitmapSource): Promise<Detected | undefined> {
  const found = await getDetector().detect(source as never);
  const first = found.find((b) => b.rawValue);
  return first ? { raw: first.rawValue, format: first.format } : undefined;
}

export async function detectInFile(file: File): Promise<Detected | undefined> {
  const bmp = await createImageBitmap(file);
  try {
    return await detectIn(bmp);
  } finally {
    bmp.close();
  }
}

export interface CameraSession { stop: () => void }

/** Start the rear camera into `video` and call onFound once with the first barcode. */
export async function startCamera(video: HTMLVideoElement, onFound: (d: Detected) => void, onError: (msg: string) => void): Promise<CameraSession> {
  if (!window.isSecureContext) throw new Error('The camera needs a secure (https) page.');
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('This browser does not offer camera access.');
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
  } catch (e) {
    const name = (e as DOMException).name;
    if (name === 'NotAllowedError') throw new Error('Camera permission was denied. Allow it in the browser’s site settings, or use handheld or manual entry.');
    if (name === 'NotFoundError' || name === 'OverconstrainedError') throw new Error('No camera was found on this device.');
    throw new Error(`Could not start the camera (${name || (e as Error).message}).`);
  }
  video.srcObject = stream;
  video.setAttribute('playsinline', 'true');
  video.muted = true;
  await video.play();

  let stopped = false;
  let busy = false;
  const timer = window.setInterval(async () => {
    if (stopped || busy || video.readyState < 2) return;
    busy = true;
    try {
      const d = await detectIn(video);
      if (d && !stopped) {
        stop();
        if (navigator.vibrate) navigator.vibrate(80);
        onFound(d);
      }
    } catch (e) {
      onError(`Decoder error: ${(e as Error).message}`);
    } finally {
      busy = false;
    }
  }, 220);

  const stop = () => {
    stopped = true;
    window.clearInterval(timer);
    stream.getTracks().forEach((t) => t.stop());
    video.srcObject = null;
  };
  return { stop };
}
