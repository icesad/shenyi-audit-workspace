# Local bidder PDF text dependency

PDF.js version **6.5.438**, Apache-2.0, [official release](https://github.com/mozilla/pdf.js/releases/tag/v6.5.438). Public package source: [npm registry artifact](https://registry.npmjs.org/pdfjs-dist/-/pdfjs-dist-6.5.438.tgz). NPM tarball integrity: `sha512-vg8Pw1x+AFKy4AMDvhuWl5cOYV8d698UoEANoFFhc79hqXDnZQqnOXoxw3HG907WHOg1JYOvLhP756boddFxpA==`.

- display: 474284 bytes; SHA-256 `3a88402882cfa3e7e72c2c9b5149f52f0f88baf1c5b62aa11a41abdbc2072440`.
- worker: 1271915 bytes; SHA-256 `1e64c8240e54735ec5913b37acd5134747799cb8c6bb3777c70adbc01232d2aa`.

Original module bytes are stored as base64 in `dist/vendor-bidder-pdf.js`. License is included in `dist/bidder-pdf-license.txt`; carry it in offline delivery ZIPs. Load the vendor script before `bidder-pdf-text.js`, then `bidder-intake.js`.

Offline compatibility: the worker is instantiated as a classic local blob Worker. The integration checks and adapts exactly two `import.meta.url` expressions and removes the final ESM export in that pinned self-contained worker source at runtime. It also disables network and classic-script loading entry points before parsing. The base64 artifact retains the original upstream bytes unchanged.

The application provides only the uploaded PDF bytes to a bounded local text worker. It does not mount the viewer, display/rasterize pages, run annotations/actions/embedded scripts, fetch remote links/fonts, perform OCR, or transmit source files. The parser can fail or omit text on scan-only PDFs, encrypted PDFs or unusual layouts. Imported fields remain a draft requiring user review.
