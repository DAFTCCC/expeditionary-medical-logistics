import { prepareZXingModule, writeBarcode } from 'zxing-wasm/writer';
import wasmUrl from 'zxing-wasm/writer/zxing_writer.wasm?url';

/**
 * DataMatrix generation (zxing-wasm writer). The WASM is bundled and cached
 * for offline use like the scanner's. Loaded lazily by the Labels page only.
 */
prepareZXingModule({
  overrides: { locateFile: (path: string, prefix: string) => (path.endsWith('.wasm') ? wasmUrl : prefix + path) },
});

/** SVG markup for a DataMatrix. With gs1=true the input must be GS1 bracket form, e.g. (01)…(17)…(10)…. */
export async function dataMatrixSvg(text: string, gs1 = false): Promise<string> {
  const r = await writeBarcode(text, { format: 'DataMatrix', options: gs1 ? 'gs1' : '', scale: 4 });
  if (r.error) throw new Error(r.error);
  return r.svg;
}
