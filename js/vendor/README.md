# Vendored code

Third-party code copied into the repository rather than fetched at run time. Everything
else in `js/` is written for MaxDock; this directory is the exception, and it is small on
purpose.

There is no bundler and no package manager here, so a dependency is a file somebody can
read, diff and check. That is the whole reason these are committed instead of pulled from
a CDN: a CDN tag is a third party who can change what the dock runs, on a screen a
receiver uses to accept a load.

## jsQR.js

Reads a QR code out of an image. Used only by `js/ui/qr-decode.js`, which is itself only
loaded by `import()` at the moment somebody presses the scan button on a browser without
`BarcodeDetector`. Nothing else in the application imports it, and no other page pays for
it.

| | |
|---|---|
| Package | [`jsqr`](https://www.npmjs.com/package/jsqr) 1.4.0 |
| File | `dist/jsQR.js` from that package, byte for byte |
| Licence | Apache-2.0, full text in `LICENSE-jsQR.txt` |
| Tarball integrity | `sha512-dxLob7q65Xg2DvstYkRpkYtmKm2sPJ9oFhrhmudT1dZvNFFTlroai3AWSpLey/w5vMcLBXRgOJsbXpdN9HzU/A==` |
| File SHA-256 | `bc40c8a15196236b2314db0856f72ca0b49980cd5413b8c852a7349f5fee0859` |

The tarball integrity above is the one npm publishes for 1.4.0, and it matched the
download. The file is unmodified, which is what makes the checksum worth quoting: anyone
can fetch the package and diff it.

It was read before it was committed. It calls nothing on the network, touches no storage,
reads no DOM, and contains no `eval` or `Function` constructor. It is a pure function from
pixel data to a decoded string. 257 KB on disk, about 57 KB over the wire compressed, paid
once by the receivers who need it.

### Updating it

    curl -sSL "$(npm view jsqr@<version> dist.tarball)" -o jsqr.tgz
    # compare the sha512 of jsqr.tgz against `npm view jsqr@<version> dist.integrity`
    tar xzf jsqr.tgz && cp package/dist/jsQR.js js/vendor/jsQR.js

Then update the version and both checksums in the table above, and re-read the diff.
`scripts/verify-qr-scan.mjs` checks that this file still records a version and a
checksum, so an update that skips the paperwork fails the build.
