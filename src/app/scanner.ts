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

/** Attach an already-opened camera stream to `video` and call onFound once with the first barcode. */
export async function startScanning(video: HTMLVideoElement, stream: MediaStream, onFound: (d: Detected) => void, onError: (msg: string) => void): Promise<CameraSession> {
  video.setAttribute('playsinline', 'true'); // iOS: must be set before play or video goes fullscreen / stays black
  video.muted = true;
  video.srcObject = stream;
  try {
    await video.play();
  } catch (e) {
    stream.getTracks().forEach((t) => t.stop());
    throw new Error(`The camera opened but the preview could not play (${(e as Error).message}).`);
  }

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
