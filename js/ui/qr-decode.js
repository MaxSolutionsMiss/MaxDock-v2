// The vendored QR decoder, given an import somebody can use.
//
// See js/vendor/README.md for what it is, where it came from and how to update it. This
// module exists so that exactly one file in the application knows how it is packaged.
//
// The vendored file is a UMD bundle. With no CommonJS and no AMD loader around it, it
// assigns itself to the global and returns nothing. Importing it for that effect and then
// taking the global is what lets the vendored file stay byte-identical to the published
// one, which is the only thing that makes the checksum in the README worth quoting. The
// cost is one global, and it is contained here.
import '../vendor/jsQR.js';

const jsQR = globalThis.jsQR;

// Loud rather than quiet. A decoder that silently is not there reads, from the dock, as a
// camera that cannot see a code that is plainly in front of it.
if (typeof jsQR !== 'function') throw new Error('The QR decoder did not load.');

export default jsQR;
