# Workpaper parser provenance

SheetJS Community Edition 0.20.3, Apache-2.0. Official standalone build downloaded from https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js on 2026-11-11. The source is held as a string in `dist/workpaper-xlsx-source.js` and executed only in a bounded local Web Worker. License: `dist/workpaper-xlsx-LICENSE.txt`. No CDN request occurs while user files are read. This parser does not calculate Excel formulas. User originals are never bundled in the Site.

Formula policy: keep original blobs; read-only formula/array/hyperlink cells in online forms; XLSX export patches only user-edited non-formula cells in their original OOXML sheet, leaves other file parts unchanged. XLS binary reserialization is intentionally not offered until fidelity is verified. Linked workbook recalculation and old Word table geometry are not marked accepted.
