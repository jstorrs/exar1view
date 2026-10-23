// @ts-check
/**
 * Raw-DEFLATE decompression (exar1 `Content.Data` has no zlib header). This is
 * the seam the inflater plugs in behind; keep the signature.
 *
 * Backed by fflate's synchronous `inflateSync`. `DecompressionStream` was
 * dropped: its per-call overhead (about 2.4-7 ms per document in Chrome) made
 * inflating thousands of small structural documents take around 10 s.
 */
import { inflateSync } from '../../vendor/fflate/browser.js';

/**
 * @param {Uint8Array} bytes
 * @returns {Promise<Uint8Array>}
 */
export async function inflateRaw(bytes) {
  if (bytes.length === 0) throw new Error('Content is empty (zero-length compressed data)');
  try {
    return inflateSync(bytes);
  } catch (err) {
    throw new Error(`Content is not valid raw DEFLATE: ${err instanceof Error ? err.message : String(err)}`);
  }
}
