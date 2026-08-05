// Reading a QR code out of the camera, wherever the browser happens to be.
//
// This used to be offered only where the browser had BarcodeDetector, which sounded like a
// narrow gap and is not one. That API sits behind a preference on Safari, is absent from
// Firefox altogether, and on desktop Chrome and Edge exists only on macOS and ChromeOS. So
// the in-app scanner appeared on Android and close to nowhere else, and the iPad standing
// at the dock, which is the device this screen was drawn for, was told to go and use the
// camera app instead.
//
// What was missing was never the camera. getUserMedia works on all of them, iOS included.
// It was only the decode step, so that is the only part with a fallback: the browser's own
// detector where it exists, and a decoder reading the pixels where it does not.
//
// The decoder is a quarter of a megabyte of vendored code, and it is fetched by import()
// at the moment somebody presses the button. A browser with the native API never requests
// it, no other page in the application can pull it in, and nobody who never scans pays for
// it. That is the trade that made vendoring it reasonable.

// The camera is the requirement now, not the decoder, because there is a decoder either
// way. getUserMedia needs a secure context, which is why this asks the browser rather than
// assuming: over plain http, mediaDevices is simply not there.
export const canScan = () => Boolean(globalThis.navigator?.mediaDevices?.getUserMedia);

// A frame off an iPad's rear camera is 1920 across. Decoding that many pixels takes longer
// than the gap between frames, so the scanner falls behind the camera: more work done, and
// it feels broken while doing it. Somebody pointing a camera at a code fills a good part of
// the frame with it, and 640 across resolves its modules with room to spare.
const MAX_EDGE = 640;

// Where the browser can do it, let it. It is faster than anything running in JavaScript,
// and on a phone it is the difference between a scan that lands as you raise the camera
// and one that takes a second of holding still.
async function nativeReader() {
  const detector = new globalThis.BarcodeDetector({ formats: ['qr_code'] });
  return {
    native: true,
    async read(video) {
      const found = await detector.detect(video);
      return found[0]?.rawValue || null;
    },
  };
}

async function pixelReader() {
  const { default: jsQR } = await import('./qr-decode.js');
  let canvas = null;
  let ctx = null;
  return {
    native: false,
    read(video) {
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      // The camera is open but has not produced a frame yet. Not an error, just not a frame.
      if (!vw || !vh) return null;
      const scale = Math.min(1, MAX_EDGE / Math.max(vw, vh));
      const w = Math.max(1, Math.round(vw * scale));
      const h = Math.max(1, Math.round(vh * scale));
      if (!canvas) {
        canvas = document.createElement('canvas');
        // Repeated getImageData off a GPU-backed canvas is the slow path; this asks for the
        // one that is not. Without it the read costs several times as much per frame.
        ctx = canvas.getContext('2d', { willReadFrequently: true });
      }
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
      ctx.drawImage(video, 0, 0, w, h);
      // Paperwork is dark on light. Asking for the inverted reading as well doubles the work
      // on every frame to catch something that does not come off a printer.
      const found = jsQR(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: 'dontInvert' });
      return found?.data || null;
    },
  };
}

// Both readers answer the same question the same way: a string, or null for this frame.
// The caller does not learn which one it got, so it cannot start behaving differently on
// one browser from the other.
export async function createReader() {
  if (typeof globalThis.BarcodeDetector === 'function') {
    // A detector that will not construct is a detector we do not have. Chrome on Linux
    // exposes the constructor and throws from it, and falling through is the whole point.
    try { return await nativeReader(); } catch { /* fall through to the pixel reader */ }
  }
  return pixelReader();
}
