// Hengdu bounded plain-body fork of Alpaq92/JSDoc @ 821695a884e0c0bb8592a635d9524bb3e116cd67; see legacy-doc-LICENSE.txt.
// SPDX-License-Identifier: 0BSD
/*
 * docToText — pure-JavaScript text extractor for legacy Microsoft Word
 * 97-2003 binary ".doc" files (the OLE2 / Compound File Binary container).
 *
 * Clean-room implementation written from Microsoft's free, openly published
 * specifications:
 *   - [MS-CFB]  Compound File Binary File Format
 *               https://learn.microsoft.com/openspecs/windows_protocols/ms-cfb/
 *   - [MS-DOC]  Word (.doc) Binary File Format
 *               https://learn.microsoft.com/openspecs/office_file_formats/ms-doc/
 * No code was read, ported, or translated from GPL tools (e.g. catdoc/antiword).
 * File formats and the algorithms that read them are not copyrightable, so this
 * from-spec implementation may be licensed permissively (0BSD).
 *
 * Public API — a single pure function, no DOM and no network:
 *
 *     docToText(input) -> string | null
 *
 *   input : ArrayBuffer | Uint8Array | Node Buffer of a .doc file.
 *   returns: the extracted main-body text, or null when the file is
 *            unsupported or unreadable (not a CFB, Word 6/95 or older,
 *            encrypted/obfuscated, or any parse error). null is the signal
 *            for the host to fall back to its download / handoff path.
 *
 * Scope (lossy by design, like a plain-text/RTF view): main document body
 * text and paragraph breaks. No fonts, images, or styles. Tables collapse to
 * tab/newline text. Headers, footers, footnotes (and endnotes, comments,
 * textboxes) are available as separate stories via docToText.sections().
 * Tracked-change *deletions* are dropped (their text is identified via the
 * sprmCFRMarkDel revision mark in the CHPX bin table); tracked *insertions* are
 * kept, so the output reflects the document with all changes accepted.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LegacyDocFactory = factory;
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---- [MS-CFB] constants -------------------------------------------------
  var CFB_SIGNATURE = [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1];
  var ENDOFCHAIN = 0xFFFFFFFE;
  var FREESECT = 0xFFFFFFFF;
  // (FATSECT 0xFFFFFFFD and DIFSECT 0xFFFFFFFC never appear as chain links.)

  // Byte -> Unicode mapping for compressed (8-bit) text, transcribed verbatim
  // from the table in [MS-DOC] "FcCompressed": a compressed character is
  // its own code point (Latin-1 identity), EXCEPT the bytes listed here. Note
  // this is *not* full Windows-1252 — 0x80, 0x8E and 0x9E are NOT remapped by
  // the spec (they stay U+0080/U+008E/U+009E). Indices below are byte - 0x80.
  var FC_COMPRESSED_MAP = [
    0x0080, 0x0081, 0x201A, 0x0192, 0x201E, 0x2026, 0x2020, 0x2021, // 80-87
    0x02C6, 0x2030, 0x0160, 0x2039, 0x0152, 0x008D, 0x008E, 0x008F, // 88-8F
    0x0090, 0x2018, 0x2019, 0x201C, 0x201D, 0x2022, 0x2013, 0x2014, // 90-97
    0x02DC, 0x2122, 0x0161, 0x203A, 0x0153, 0x009D, 0x009E, 0x0178  // 98-9F
  ];

  // ------------------------------------------------------------------------
  // Public entry points
  // ------------------------------------------------------------------------

  // Parse the whole document into its text stories, or null on failure.
  function parse(input, structureMode) {
    try {
      var bytes = toUint8(input);
      if (!bytes || bytes.length < 512) return null;
      var cfb = parseCfb(bytes);
      if (!cfb) return null;
      var wordDocument = cfb.byName['WordDocument'];
      if (!wordDocument) return null;
      return parseWord(cfb.getStream(wordDocument), cfb, structureMode);
    } catch (e) {
      return null; // any failure -> graceful handoff
    }
  }

  // docToText(input) -> main-body text, or null (unchanged, back-compatible).
  function docToText(input) {
    var doc = parse(input);
    return doc ? doc.body : null;
  }

  // docToText.sections(input) -> { body, footnotes, headers, annotations,
  // endnotes, textboxes, headerTextboxes } (each a string; "" when empty), or
  // null. These are the document's separate text stories, which follow the
  // main body consecutively in the same piece table. `body` === docToText().
  // The object also carries `.html` (see below).
  docToText.sections = parse;
  // Real Word paragraph outline only: no numbering/font/name heuristics.
  docToText.structure = function (input) {
    var doc = parse(input, true); return doc ? doc.structure : null;
  };

  // docToText.html(input) -> { body, footnotes, ... } where each is styled HTML
  // for that story: text runs wrapped in <span> with the run's character
  // formatting (bold/italic/underline/strike/size/color/font), with \t between
  // table cells and \n at row/paragraph breaks. Or null on failure.
  docToText.html = function (input) { var doc = parse(input); return doc ? doc.html : null; };
  docToText.model = function (input) { var doc = parse(input); return doc ? doc.model : null; };
  // Internal list-marker helpers, exposed for unit tests (the numbered path isn't
  // reachable through the bullet-only writer skeleton). Not part of the public API.
  docToText._lists = { fmtNum: fmtNum, makeNumberer: makeListNumberer };

  // docToText.images(input) -> [{ mime, bytes }] for embedded raster images
  // (PNG/JPEG), best effort. Word stores pictures/OLE images as raw image bytes
  // somewhere in the CFB streams; we carve complete images by signature from the
  // reassembled streams (CFB sector fragmentation already handled), validating
  // each by parsing to its real end marker. WMF/EMF metafiles aren't raster and
  // can't render in-browser, so they're skipped; exact inline placement isn't
  // reconstructed. Returns null on failure (not a CFB).
  docToText.images = function (input) {
    try { var cfb = parseCfb(toUint8(input)); return cfb ? carveImages(cfb) : null; }
    catch (e) { return null; }
  };

  function matchSig(b, i, sig) {
    if (i + sig.length > b.length) return false;
    for (var k = 0; k < sig.length; k++) if (b[i + k] !== sig[k]) return false;
    return true;
  }
  // End of a PNG: walk chunks (length+type+data+crc) to IEND. -1 if malformed.
  function pngEnd(b, start) {
    var p = start + 8;
    while (p + 12 <= b.length) {
      var len = b[p] * 0x1000000 + (b[p + 1] << 16) + (b[p + 2] << 8) + b[p + 3];
      var type = String.fromCharCode(b[p + 4], b[p + 5], b[p + 6], b[p + 7]);
      p += 12 + len;
      if (type === 'IEND') return p <= b.length ? p : -1;
      if (len < 0 || p > b.length) return -1;
    }
    return -1;
  }
  // End of a JPEG: parse markers/segments to EOI (FF D9). -1 if malformed.
  function jpegEnd(b, start) {
    var p = start + 2;
    while (p + 1 < b.length) {
      if (b[p] !== 0xFF) { p++; continue; }
      var m = b[p + 1];
      if (m === 0xD9) return p + 2;                                  // EOI
      if (m === 0x01 || m === 0xFF || (m >= 0xD0 && m <= 0xD8)) { p += 2; continue; }
      if (p + 3 >= b.length) return -1;
      p += 2 + ((b[p + 2] << 8) | b[p + 3]);                         // skip segment
      if (m === 0xDA) {                                              // SOS -> scan entropy data
        while (p + 1 < b.length && !(b[p] === 0xFF && b[p + 1] !== 0x00 && !(b[p + 1] >= 0xD0 && b[p + 1] <= 0xD7))) p++;
      }
    }
    return -1;
  }
  function carveImages(cfb) {
    var SIGS = [
      { mime: 'image/png', sig: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], end: pngEnd },
      { mime: 'image/jpeg', sig: [0xff, 0xd8, 0xff], end: jpegEnd }
    ];
    var images = [], seen = {};
    for (var name in cfb.byName) {
      var b = cfb.getStream(cfb.byName[name]);
      for (var i = 0; i + 3 < b.length; i++) {
        for (var s = 0; s < SIGS.length; s++) {
          if (matchSig(b, i, SIGS[s].sig)) {
            var end = SIGS[s].end(b, i);
            if (end > i + 32) {                          // a real image, not a stray signature
              var key = SIGS[s].mime + ':' + (end - i);
              if (!seen[key]) { seen[key] = 1; images.push({ mime: SIGS[s].mime, bytes: b.subarray(i, end) }); }
              i = end - 1;
            }
            break;
          }
        }
      }
    }
    return images;
  }

  // ------------------------------------------------------------------------
  // Layer 1 — [MS-CFB] OLE2 container
  // ------------------------------------------------------------------------
  function parseCfb(bytes) {
    var dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

    for (var i = 0; i < 8; i++) {
      if (bytes[i] !== CFB_SIGNATURE[i]) return null; // not a compound file
    }

    var sectorShift = dv.getUint16(30, true);
    var miniSectorShift = dv.getUint16(32, true);
    var sectorSize = 1 << sectorShift;       // 512 (v3) or 4096 (v4)
    var miniSectorSize = 1 << miniSectorShift; // 64
    if (sectorSize !== 512 && sectorSize !== 4096) return null;

    var firstDirSector = dv.getUint32(48, true);
    var miniStreamCutoff = dv.getUint32(56, true);   // usually 4096
    var firstMiniFatSector = dv.getUint32(60, true);
    var numMiniFatSectors = dv.getUint32(64, true);
    var firstDifatSector = dv.getUint32(68, true);
    var numDifatSectors = dv.getUint32(72, true);

    function sectorOffset(sid) { return (sid + 1) * sectorSize; }

    // -- Collect FAT sector locations: 109 in the header DIFAT, then chain. --
    var fatSectorLocs = [];
    for (var d = 0; d < 109; d++) {
      var loc = dv.getUint32(76 + d * 4, true);
      if (loc === FREESECT || loc === ENDOFCHAIN) break;
      fatSectorLocs.push(loc);
    }
    var entriesPerDifat = (sectorSize / 4) - 1; // last slot links to next DIFAT
    var difatSid = firstDifatSector;
    var difatGuard = numDifatSectors + 8;
    while (difatSid !== ENDOFCHAIN && difatSid !== FREESECT && difatGuard-- > 0) {
      var dbase = sectorOffset(difatSid);
      if (dbase + sectorSize > bytes.length) break;
      for (var k = 0; k < entriesPerDifat; k++) {
        var fl = dv.getUint32(dbase + k * 4, true);
        if (fl !== FREESECT && fl !== ENDOFCHAIN) fatSectorLocs.push(fl);
      }
      difatSid = dv.getUint32(dbase + entriesPerDifat * 4, true);
    }

    // -- Read the FAT into one flat Uint32Array. --
    var entriesPerSector = sectorSize / 4;
    var fat = new Uint32Array(fatSectorLocs.length * entriesPerSector);
    var fi = 0;
    for (var f = 0; f < fatSectorLocs.length; f++) {
      var foff = sectorOffset(fatSectorLocs[f]);
      for (var e = 0; e < entriesPerSector; e++) {
        fat[fi++] = (foff + e * 4 + 4 <= bytes.length)
          ? dv.getUint32(foff + e * 4, true) : FREESECT;
      }
    }

    // -- Follow a FAT chain, returning its bytes (clamped to sizeLimit). --
    function readChain(startSid, sizeLimit) {
      var chunks = [];
      var sid = startSid;
      var guard = fat.length + 8;
      var collected = 0;
      while (sid !== ENDOFCHAIN && sid !== FREESECT && guard-- > 0) {
        if (sid >= fat.length) break;
        var off = sectorOffset(sid);
        if (off >= bytes.length) break;
        var endOff = Math.min(off + sectorSize, bytes.length);
        chunks.push(bytes.subarray(off, endOff));
        collected += endOff - off;
        if (sizeLimit != null && collected >= sizeLimit) break;
        sid = fat[sid];
      }
      return concat(chunks, sizeLimit);
    }

    // -- Directory. --
    var dirBytes = readChain(firstDirSector, null);
    var dirDv = new DataView(dirBytes.buffer, dirBytes.byteOffset, dirBytes.byteLength);
    var numEntries = Math.floor(dirBytes.length / 128);
    var root = null;
    var byName = {};
    for (var n = 0; n < numEntries; n++) {
      var base = n * 128;
      var type = dirBytes[base + 66]; // 0 unalloc, 1 storage, 2 stream, 5 root
      if (type !== 1 && type !== 2 && type !== 5) continue;
      var nameLen = dirDv.getUint16(base + 64, true); // bytes incl. terminator
      var name = '';
      if (nameLen > 2) {
        var chars = (nameLen >> 1) - 1;
        for (var c = 0; c < chars; c++) {
          name += String.fromCharCode(dirDv.getUint16(base + c * 2, true));
        }
      }
      var start = dirDv.getUint32(base + 116, true);
      var sizeLow = dirDv.getUint32(base + 120, true);
      var sizeHigh = dirDv.getUint32(base + 124, true); // 0 for v3
      var entry = { name: name, type: type, start: start,
                    size: sizeHigh * 0x100000000 + sizeLow };
      if (type === 5) root = entry;
      else if (type === 2) byName[name] = entry;
    }
    if (!root) return null;

    // -- Mini-FAT + mini stream (small streams live here). --
    var miniStream = readChain(root.start, root.size);
    var miniFatBytes = (numMiniFatSectors > 0 && firstMiniFatSector !== ENDOFCHAIN)
      ? readChain(firstMiniFatSector, null) : new Uint8Array(0);
    var miniFat = new Uint32Array(miniFatBytes.length >> 2);
    var mfDv = new DataView(miniFatBytes.buffer, miniFatBytes.byteOffset, miniFatBytes.byteLength);
    for (var mi = 0; mi < miniFat.length; mi++) miniFat[mi] = mfDv.getUint32(mi * 4, true);

    function readMiniChain(startSid, sizeLimit) {
      var chunks = [];
      var sid = startSid;
      var guard = miniFat.length + 8;
      var collected = 0;
      while (sid !== ENDOFCHAIN && sid !== FREESECT && guard-- > 0) {
        var off = sid * miniSectorSize;
        if (off >= miniStream.length) break;
        var endOff = Math.min(off + miniSectorSize, miniStream.length);
        chunks.push(miniStream.subarray(off, endOff));
        collected += endOff - off;
        if (sizeLimit != null && collected >= sizeLimit) break;
        sid = (sid < miniFat.length) ? miniFat[sid] : ENDOFCHAIN;
      }
      return concat(chunks, sizeLimit);
    }

    function getStream(entry) {
      // The mini stream itself is always in the FAT; everything else picks a
      // home by size relative to the cutoff.
      return (entry.size >= miniStreamCutoff)
        ? readChain(entry.start, entry.size)
        : readMiniChain(entry.start, entry.size);
    }

    return { byName: byName, getStream: getStream };
  }

  // ------------------------------------------------------------------------
  // Layer 2 — [MS-DOC] Word stream: FIB -> CLX (piece table) -> text
  // ------------------------------------------------------------------------
  function parseWord(wd, cfb, structureMode) {
    if (wd.length < 0x20) return null;
    var dv = new DataView(wd.buffer, wd.byteOffset, wd.byteLength);

    // FibBase
    if (dv.getUint16(0, true) !== 0xA5EC) return null;   // wIdent
    var nFib = dv.getUint16(2, true);
    if (nFib < 0x00C1) return null;                       // Word 6/95 or older

    var flags = dv.getUint16(10, true);
    var fEncrypted = (flags & 0x0100) !== 0;  // bit 8
    var fWhichTblStm = (flags & 0x0200) !== 0; // bit 9
    var fObfuscated = (flags & 0x8000) !== 0;  // bit 15 (XOR obfuscation)
    if (fEncrypted || fObfuscated) return null;           // we do not decrypt

    // Walk the variable-length FIB to find fibRgLw (for ccpText) and the
    // FibRgFcLcb blob (for fcClx/lcbClx). Counts are read from the file rather
    // than hard-coded, so the same code works for the Word 97/2000/2002/2003
    // FIB variants (which only ever extend this prefix).
    var pos = 0x20;
    var csw = dv.getUint16(pos, true); pos += 2;          // count of 16-bit
    pos += csw * 2;                                        // skip fibRgW
    var cslw = dv.getUint16(pos, true); pos += 2;          // count of 32-bit
    var fibRgLwStart = pos;
    pos += cslw * 4;                                        // skip fibRgLw
    /* cbRgFcLcb */ dv.getUint16(pos, true); pos += 2;
    var fibRgFcLcbStart = pos;

    // Character counts of each text "story". They sit consecutively in the
    // piece table after the main body, in this order (ccpMcr at index 6 is
    // reserved and not part of the chain). [MS-DOC] FibRgLw97 + the PlcPcd
    // aCP note (last CP = ccpText + sum of these + 1).
    if (fibRgLwStart + 16 > wd.length) return null;
    function rgLw(i) { var o = fibRgLwStart + i * 4; return o + 4 <= wd.length ? dv.getUint32(o, true) : 0; }
    var ccpText = rgLw(3); if (ccpText < 0) ccpText = 0;
    var ccpFtn = rgLw(4), ccpHdd = rgLw(5), ccpAtn = rgLw(7),
        ccpEdn = rgLw(8), ccpTxbx = rgLw(9), ccpHdrTxbx = rgLw(10);

    // fcClx / lcbClx = pair index 33 of FibRgFcLcb97.
    var clxPair = fibRgFcLcbStart + 33 * 8;
    if (clxPair + 8 > wd.length) return null;
    var fcClx = dv.getUint32(clxPair, true);
    var lcbClx = dv.getUint32(clxPair + 4, true);
    if (lcbClx === 0) return null;                         // no piece table

    // The CLX lives in the table stream chosen by fWhichTblStm.
    var table = cfb.byName[fWhichTblStm ? '1Table' : '0Table'];
    if (!table) table = cfb.byName[fWhichTblStm ? '0Table' : '1Table'];
    if (!table) return null;
    var tableBytes = cfb.getStream(table);
    if (fcClx >= tableBytes.length) return null;
    if (fcClx + lcbClx > tableBytes.length) lcbClx = tableBytes.length - fcClx;

    var pieces = parsePieceTable(tableBytes, fcClx, lcbClx);
    if (!pieces) return null;

    // Character runs (formatting + tracked-deletion flag). Deletions are
    // dropped from every story; the formatting feeds the styled HTML output.
    var chpx = parseChpx(wd, tableBytes, fibRgFcLcbStart, dv);
    var isDeleted = makeIsDeleted(chpx);
    if (structureMode) return { structure: extractOutline(wd, tableBytes,
      fibRgFcLcbStart, dv, pieces, ccpText, fcClx, lcbClx, isDeleted) };
    // Plain-body mode does not need font extraction.
    var styles = parseStsh(tableBytes, fibRgFcLcbStart, dv);
    var papx = parsePapx(wd, tableBytes, fibRgFcLcbStart, dv);
    // Hengdu plain-body fork: no styled HTML/models, other stories, metadata or image carving.
    var listInfo = parseListDefs(tableBytes, fibRgFcLcbStart, dv);
    var stylePap = styles ? styles.pap : null;
    function paraList(fc) {
      var r = papx ? runAt(papx, fc) : null; if (!r) return null;
      var ilfo = r.ilfo, ilvl = r.ilvl != null ? r.ilvl : 0;
      if (ilfo == null && stylePap && r.istd != null) {
        var sp = stylePap[r.istd];
        if (sp && sp.ilfo >= 1 && sp.ilfo <= 0x07FE) { ilfo = sp.ilfo; if (r.ilvl == null) ilvl = sp.ilvl || 0; }
      }
      return ilfo ? { ilvl:ilvl, ilfo:ilfo, kind:listInfo && listInfo.kind[ilfo] || 'bullet' } : null;
    }
    function paraIsTtp(fc) { var r = papx ? runAt(papx, fc) : null; return !!(r && r.ttp); }
    return { body:extractRange(wd,pieces,0,ccpText,isDeleted,paraIsTtp,paraList,listInfo ? listInfo.defs : null) };
  }

  // Parse the CLX: zero or more Prc records, then a Pcdt holding the PlcPcd
  // (the piece table). See [MS-DOC] structures "Clx", "Pcdt", "PlcPcd", "Pcd",
  // "FcCompressed", and the master algorithm [MS-DOC] 2.4.1 "Retrieving Text".
  function parsePieceTable(table, fcClx, lcbClx) {
    var dv = new DataView(table.buffer, table.byteOffset, table.byteLength);
    var p = fcClx;
    var end = fcClx + lcbClx;
    var plcOff = -1, plcLen = 0;

    while (p < end) {
      var clxt = table[p];
      if (clxt === 0x01) {              // Prc: 1 + 2 + cbGrpprl bytes
        if (p + 3 > end) break;
        var cbGrpprl = dv.getInt16(p + 1, true);
        if (cbGrpprl < 0 || p + 3 + cbGrpprl > end) return null;
        p += 3 + cbGrpprl;
      } else if (clxt === 0x02) {       // Pcdt: clxt + lcb(4) + PlcPcd(lcb)
        if (p + 5 > end) break;
        plcLen = dv.getUint32(p + 1, true);
        plcOff = p + 5;
        break;
      } else {
        break;
      }
    }
    if (plcOff < 0) return null;
    if (plcOff + plcLen > table.length) plcLen = table.length - plcOff;

    // PlcPcd = (n+1) CPs (4 bytes each) followed by n PCDs (8 bytes each).
    var n = Math.floor((plcLen - 4) / 12);
    if (n < 1) return null;

    var cps = new Array(n + 1);
    for (var i = 0; i <= n; i++) cps[i] = dv.getUint32(plcOff + i * 4, true);
    var pcdBase = plcOff + (n + 1) * 4;

    var pieces = [];
    for (var j = 0; j < n; j++) {
      var fcVal = dv.getUint32(pcdBase + j * 8 + 2, true); // Pcd.fc (FcCompressed)
      var compressed = (fcVal & 0x40000000) !== 0;          // bit 30 = fCompressed
      var fc = fcVal & 0x3FFFFFFF;
      pieces.push({
        cpStart: cps[j],
        cpEnd: cps[j + 1],
        // compressed: 1 cp1252 byte/char at fc/2; else 2 UTF-16LE bytes/char at fc
        offset: compressed ? (fc >>> 1) : fc,
        compressed: compressed
      });
    }
    return pieces;
  }


  // ---- bounded Word paragraph outline ([MS-DOC] 2.4.6 / 2.6.2) ----------
  // This path is deliberately independent of the lossy HTML/model code. It
  // reads paragraph marks, PAPX, STSH inheritance and the piece's PRM. The
  // calling legacy-doc wrapper MUST perform its CFB/FIB/CLX preflight first.
  function outlineFail() { throw new Error('DOC outline unsupported'); }
  function outlineOps(buf, begin, end) {
    if (begin < 0 || end < begin || end > buf.length) outlineFail();
    var ops = [];
    for (var p = begin; p < end;) {
      // A PAPX may have one trailing zero padding byte.
      if (p + 1 === end && buf[p] === 0) break;
      if (p + 2 > end) outlineFail();
      var sc = buf[p] | buf[p + 1] << 8, len = sprmOperandLen(sc, buf, p + 2);
      if (sc === 0xD608) {
        if (p + 4 > end) outlineFail();
        len = 1 + (buf[p + 2] | buf[p + 3] << 8);
      }
      // The long 255-byte tab-change exception needs a separate decoder;
      // never guess a later SPRM's boundary and invent an outline level.
      if ((sc === 0xC615 || sc === 0xC60D) && buf[p + 2] === 255) outlineFail();
      if (!(len > 0) || p + 2 + len > end) outlineFail();
      if (sc === 0x2640) { if (buf[p + 2] > 9) outlineFail(); ops.push(['outline',buf[p + 2]]); }
      else if (sc === 0x4600) ops.push(['style',buf[p + 2] | buf[p + 3] << 8]);
      else if (sc === 0x2602) ops.push(['increment',buf[p + 2] << 24 >> 24]);
      else if (sc === 0x0800) ops.push(['deleted',(buf[p + 2] & 1) === 1]);
      // These can redirect paragraph properties to another stream/map.
      // Fail closed rather than silently using a possibly wrong heading.
      else if (sc === 0xC601 || sc === 0x6645 || sc === 0x6646) outlineFail();
      p += 2 + len;
    }
    return ops;
  }
  function outlineStyles(table, start, fib) {
    var fc = fib.getUint32(start + 8,true), len = fib.getUint32(start + 12,true);
    if (len < 6 || fc + len > table.length) outlineFail();
    var d = new DataView(table.buffer,table.byteOffset,table.byteLength), end = fc + len;
    var cb = d.getUint16(fc,true), count = d.getUint16(fc+2,true), baseSize = d.getUint16(fc+4,true);
    if (cb < 4 || fc + 2 + cb > end || count < 1 || count > 4096 || baseSize < 10 || baseSize > 18) outlineFail();
    var p = fc + 2 + cb, raw = [], cache = [], active = [];
    for (var i=0;i<count;i++) {
      if (p+2>end) outlineFail(); var size=d.getUint16(p,true);p+=2;
      if (!size) { raw.push(null);continue; }
      var a=p,z=p+size;p=z;
      if (z>end || a+baseSize+2>z) outlineFail();
      var w=d.getUint16(a+2,true), kind=w&15, parent=w>>>4, upCount=d.getUint16(a+4,true)&15;
      var nameAt=a+baseSize,cch=d.getUint16(nameAt,true);
      if (cch>255 || nameAt+2+cch*2+2>z || d.getUint16(nameAt+2+cch*2,true)!==0) outlineFail();
      var name='';for(var nc=0;nc<cch;nc++)name+=String.fromCharCode(d.getUint16(nameAt+2+nc*2,true));
      var up=nameAt+2+cch*2+2,ops=[];
      for(var j=0;j<upCount;j++){
        if(up+2>z)outlineFail();var ulen=d.getUint16(up,true);up+=2;
        if(up+ulen>z)outlineFail();
        if(kind===1&&j===0){if(ulen<2)outlineFail();ops=outlineOps(table,up+2,up+ulen);}
        up+=ulen;if(up&1)up++;
      }
      raw.push({name:name,kind:kind,base:parent,ops:ops});
    }
    function resolve(i,depth){
      if(i<0||i>=count||!raw[i]||raw[i].kind!==1||depth>64||active[i])outlineFail();
      if(cache[i])return cache[i];active[i]=true;var r=raw[i],outline=9;
      if(r.base!==0x0fff){if(r.base===i)outlineFail();outline=resolve(r.base,depth+1).outline;}
      // Heading 1..9 occupy reserved istd 1..9; this is a file-format
      // rule, not a guess based on a localized style name.
      if(i>=1&&i<=9)outline=i-1;
      for(var n=0;n<r.ops.length;n++){
        var op=r.ops[n];if(op[0]==='outline'){if(i<1||i>9)outline=op[1];}
        else if(op[0]!=='deleted')outlineFail();
      }
      active[i]=false;return(cache[i]={name:r.name,outline:outline});
    }
    // Resolve on demand: unused character/table styles do not become headings.
    return {get:function(i){return resolve(i,0);}};
  }
  function outlinePapx(wd,table,start,fib){
    var fc=fib.getUint32(start+13*8,true),len=fib.getUint32(start+13*8+4,true);
    if(len<12||(len-4)%8||fc+len>table.length)outlineFail();
    var t=new DataView(table.buffer,table.byteOffset,table.byteLength),d=new DataView(wd.buffer,wd.byteOffset,wd.byteLength);
    var n=(len-4)/8,runs=[],seen=new Set();if(n>Math.floor(wd.length/512))outlineFail();
    for(var j=0;j<n;j++){
      var pn=t.getUint32(fc+(n+1)*4+j*4,true)&0x003fffff,off=pn*512;
      if(seen.has(pn)||off+512>wd.length)outlineFail();seen.add(pn);
      var count=wd[off+511],bx=off+4*(count+1),floor=bx+13*count;
      if(count<1||count>29||floor>off+511)outlineFail();
      for(var i=0;i<count;i++){
        var a=d.getUint32(off+i*4,true),b=d.getUint32(off+(i+1)*4,true);
        if(b<=a||b>wd.length||runs.length>=30000)outlineFail();
        var rel=wd[bx+i*13],istd=0,ops=[];
        if(rel){
          var pa=off+rel*2;if(pa<floor||pa+2>off+511)outlineFail();
          var cb=wd[pa],g=cb?pa+1:pa+2,z=cb?pa+2*cb:pa+2+2*wd[pa+1];
          if((!cb&&!wd[pa+1])||g+2>z||z>off+511)outlineFail();
          istd=d.getUint16(g,true);ops=outlineOps(wd,g+2,z);
        }
        runs.push({a:a,b:b,istd:istd,ops:ops});
      }
    }
    runs.sort(function(a,b){return a.a-b.a;});
    for(var k=1;k<runs.length;k++)if(runs[k].a<runs[k-1].b)outlineFail();
    return runs;
  }
  function outlinePieceOps(table,fc,len,pieces){
    var d=new DataView(table.buffer,table.byteOffset,table.byteLength),p=fc,end=fc+len,prcs=[];
    while(p<end&&table[p]===1){
      if(p+3>end)outlineFail();var size=d.getInt16(p+1,true);
      if(size<0||p+3+size>end||prcs.length>=30000)outlineFail();
      prcs.push(outlineOps(table,p+3,p+3+size));p+=3+size;
    }
    if(p+5>end||table[p]!==2)outlineFail();
    var plc=p+5,n=pieces.length,pcd=plc+4*(n+1);
    if(pcd+n*8>end)outlineFail();
    for(var i=0;i<n;i++){
      var prm=d.getUint16(pcd+i*8+6,true),ops=[];
      if(prm&1){var idx=prm>>>1;if(idx>=prcs.length)outlineFail();ops=prcs[idx];}
      else if(prm){
        var code=prm>>>1&127,val=prm>>>8;
        if(code===0x78){if(val>9)outlineFail();ops=[['outline',val]];}
        else if(code===0x04)ops=[['increment',val<<24>>24]];
        else if(code===0x41)ops=[['deleted',(val&1)===1]];
        // Remaining Prm0 values modify only layout, list or character
        // appearance and cannot turn a body paragraph into a heading.
      }
      pieces[i].outlineOps=ops;
      // Resolve revision overrides once per piece, not once per character.
      for(var di=0;di<ops.length;di++)if(ops[di][0]==='deleted')pieces[i].outlineDeleted=ops[di][1];
    }
  }
  function outlineDeletion(wd,table,start,fib){
    var fc=fib.getUint32(start+12*8,true),len=fib.getUint32(start+12*8+4,true);
    if(!len)return null;
    if(len<12||(len-4)%8||fc+len>table.length)outlineFail();
    var t=new DataView(table.buffer,table.byteOffset,table.byteLength),d=new DataView(wd.buffer,wd.byteOffset,wd.byteLength);
    var n=(len-4)/8,runs=[],seen=new Set();if(n>Math.floor(wd.length/512))outlineFail();
    for(var j=0;j<n;j++){
      var pn=t.getUint32(fc+(n+1)*4+j*4,true)&0x003fffff,off=pn*512;
      if(seen.has(pn)||off+512>wd.length)outlineFail();seen.add(pn);
      var count=wd[off+511],bx=off+4*(count+1),floor=bx+count;
      if(count<1||floor>off+511)outlineFail();
      for(var i=0;i<count;i++){
        var a=d.getUint32(off+i*4,true),b=d.getUint32(off+(i+1)*4,true),word=wd[bx+i],del=false;
        if(b<=a||b>wd.length||runs.length>=30000)outlineFail();
        if(word){
          var at=off+word*2;if(at<floor||at+1>off+511)outlineFail();
          var end=at+1+wd[at];if(end>off+511)outlineFail();
          var ops=outlineOps(wd,at+1,end);
          for(var k=0;k<ops.length;k++)if(ops[k][0]==='deleted')del=ops[k][1];
        }
        runs.push({a:a,b:b,p:{del:del}});
      }
    }
    runs.sort(function(a,b){return a.a-b.a;});
    for(var i=1;i<runs.length;i++)if(runs[i].a<runs[i-1].b)outlineFail();
    return makeIsDeleted(runs);
  }
  function extractOutline(wd,table,start,fib,pieces,hi,fcClx,lcbClx,isDeleted){
    isDeleted=outlineDeletion(wd,table,start,fib);
    var styles=outlineStyles(table,start,fib),papx=outlinePapx(wd,table,start,fib);
    outlinePieceOps(table,fcClx,lcbClx,pieces);
    var result=[],buf=[],stack=[],lastFc=null,lastPiece=null,total=0,formatBudget=1000000;
    function info(fc,pc){
      var r=runAt(papx,fc);if(!r)outlineFail();
      var istd=r.istd,s=styles.get(istd),outline=s.outline,name=s.name;
      function apply(ops){if((formatBudget-=ops.length)<0)outlineFail();for(var i=0;i<ops.length;i++){
        var op=ops[i];
        if(op[0]==='style'){istd=op[1];s=styles.get(istd);outline=s.outline;name=s.name;}
        else if(op[0]==='outline'){if(istd<1||istd>9)outline=op[1];}
        else if(op[0]==='increment'){
          if(istd>=1&&istd<=9){istd=Math.max(1,Math.min(9,istd+op[1]));s=styles.get(istd);outline=s.outline;name=s.name;}
          else if(outline!==9)outline=Math.max(0,Math.min(9,outline+op[1]));
        }
      }}
      apply(r.ops);apply(pc.outlineOps);
      return {text:buf.join(''),level:outline<9?outline+1:null,styleName:name};
    }
    function flush(fc,pc){if(result.length>=20000)outlineFail();result.push(info(fc,pc));buf=[];}
    function feed(code,fc,pc){
      var deleted=isDeleted&&isDeleted(fc);
      if(pc.outlineDeleted!=null)deleted=pc.outlineDeleted;
      if(deleted)return;lastFc=fc;lastPiece=pc;
      if(code===0x13){if(stack.length>=64)outlineFail();stack.push(true);return;}
      if(code===0x14){if(stack.length)stack[stack.length-1]=false;return;}
      if(code===0x15){if(stack.length)stack.pop();return;}
      for(var j=0;j<stack.length;j++)if(stack[j])return;
      if(code===7)outlineFail(); // tables need their own structural importer
      if(code===13){flush(fc,pc);return;}
      var ch=mapChar(code);if(ch){if((total+=ch.length)>150000)outlineFail();buf.push(ch);}
    }
    for(var i=0;i<pieces.length;i++){
      var pc=pieces[i],a=Math.max(0,pc.cpStart),b=Math.min(hi,pc.cpEnd);
      for(var cp=a;cp<b;cp++){
        var at=pc.offset+(cp-pc.cpStart)*(pc.compressed?1:2),c=wd[at];
        if(pc.compressed)c=c<128?c:c<=159?FC_COMPRESSED_MAP[c-128]:c;
        else c|=wd[at+1]<<8;
        feed(c,at,pc);
      }
    }
    if(stack.length)outlineFail();if(buf.length&&lastPiece)flush(lastFc,lastPiece);
    return {paragraphs:result,source:'word-outline'};
  }

  // ---- character runs & formatting ([MS-DOC] CHPX bin table) ---------------
  // Every run's character properties live in CHPX FKP "pages" indexed by
  // PlcfBteChpx (FibRgFcLcb97 #12). parseChpx returns the runs in WordDocument
  // byte order, each with the direct character properties we use: the tracked-
  // deletion flag plus bold/italic/strike/underline/size/color/font/char-style.
  function parseChpx(wd, table, fibRgFcLcbStart, fibDv) {
    try {
      var pair = fibRgFcLcbStart + 12 * 8;
      if (pair + 8 > wd.length) return null;
      var fc = fibDv.getUint32(pair, true);
      var lcb = fibDv.getUint32(pair + 4, true);
      if (lcb < 4 || fc < 0 || fc + lcb > table.length) return null;
      var tdv = new DataView(table.buffer, table.byteOffset, table.byteLength);
      var n = Math.floor((lcb - 4) / 8);          // PlcfBteChpx: n+1 FCs + n PNs
      if (n < 1) return null;
      var pnBase = fc + (n + 1) * 4;
      var runs = [];
      for (var i = 0; i < n; i++) {
        var pn = tdv.getUint32(pnBase + i * 4, true) & 0x003FFFFF; // PnFkpChpx.pn
        collectFkpRuns(wd, pn * 512, runs);
      }
      runs.sort(function (x, y) { return x.a - y.a; });
      return runs;
    } catch (e) { return null; }
  }

  // One ChpxFkp page (512 bytes at pn*512): crun at byte 511, rgfc[crun+1],
  // then rgb[crun] (word offsets to each Chpx; 0 = default props).
  function collectFkpRuns(wd, pageOff, runs) {
    if (pageOff < 0 || pageOff + 512 > wd.length) return;
    var dv = new DataView(wd.buffer, wd.byteOffset, wd.byteLength);
    var crun = wd[pageOff + 511];
    if (!crun) return;
    var rgbBase = pageOff + 4 * (crun + 1);
    for (var i = 0; i < crun; i++) {
      var a = dv.getUint32(pageOff + i * 4, true);
      var b = dv.getUint32(pageOff + (i + 1) * 4, true);
      if (b <= a) continue;
      var props = {};
      var word = wd[rgbBase + i];
      if (word) {
        var chpxOff = pageOff + word * 2;             // Chpx: cb, then grpprl
        if (chpxOff >= pageOff && chpxOff < pageOff + 512) {
          var cb = wd[chpxOff];
          if (chpxOff + 1 + cb <= pageOff + 512) props = parseChpGrpprl(wd, chpxOff + 1, cb);
        }
      }
      runs.push({ a: a, b: b, p: props });
    }
  }

  // Decode the character sprms we render from a Chpx grpprl. Codes verified
  // empirically against real documents. ToggleOperand props (bold/italic/...)
  // are "on" exactly when bit 0 of the operand is set (covers 0x01 and 0x81 —
  // 0x81 = "invert the off style default" = on; the same rule as deletions).
  function parseChpGrpprl(wd, off, len) {
    var p = {}, q = off, end = off + len;
    while (q + 2 <= end) {
      var sprm = wd[q] | (wd[q + 1] << 8); q += 2;
      switch (sprm) {
        case 0x0800: p.del = (wd[q] & 1) === 1; break;        // sprmCFRMarkDel (deletion)
        case 0x0835: p.b = (wd[q] & 1) === 1; break;          // bold
        case 0x0836: p.i = (wd[q] & 1) === 1; break;          // italic
        case 0x0837: p.strike = (wd[q] & 1) === 1; break;     // strikethrough
        case 0x083A: p.smallCaps = (wd[q] & 1) === 1; break;  // sprmCFSmallCaps
        case 0x083B: p.caps = (wd[q] & 1) === 1; break;       // sprmCFCaps (all caps)
        case 0x083C: p.hidden = (wd[q] & 1) === 1; break;     // vanish (hidden text)
        case 0x2A3E: p.u = wd[q]; break;                       // underline kind (0 = none, 1 = single, 3 = double, ...)
        case 0x2A48: p.iss = wd[q]; break;                     // sprmCSs: 0 none, 1 superscript, 2 subscript
        case 0x2A53: p.dstrike = (wd[q] & 1) === 1; break;     // sprmCFDStrike: double strikethrough
        case 0x8840: p.dxaSpace = (wd[q] | (wd[q + 1] << 8)) << 16 >> 16; break;  // sprmCDxaSpace: character spacing (signed twips; + expanded, - condensed)
        case 0x4845: p.hpsPos = (wd[q] | (wd[q + 1] << 8)) << 16 >> 16; break;    // sprmCHpsPos: character position (signed half-points; + raised, - lowered)
        case 0x2A0C: p.highlightIco = wd[q]; break;            // sprmCHighlight: 16-colour palette index (0 = none)
        case 0x4A43: p.hps = wd[q] | (wd[q + 1] << 8); break;  // font size, half-points
        case 0x2A42: p.ico = wd[q]; break;                     // color, 16-colour palette index
        case 0x6870: p.cv = (wd[q] | (wd[q + 1] << 8) | (wd[q + 2] << 16)) >>> 0; break; // 24-bit RGB
        case 0x4A4F: p.ftc = wd[q] | (wd[q + 1] << 8); break;  // font index (ftc0) -> SttbfFfn
        case 0x4A30: p.istd = wd[q] | (wd[q + 1] << 8); break; // character style index
        case 0x6A03: p.picLoc = (wd[q] | (wd[q + 1] << 8) | (wd[q + 2] << 16) | (wd[q + 3] << 24)) >>> 0; break; // sprmCPicLocation (Data offset)
        case 0x0855: p.fSpec = wd[q] & 1; break;               // sprmCFSpec (special char, e.g. picture)
      }
      q += sprmOperandLen(sprm, wd, q);
    }
    return p;
  }

  // Operand size from the sprm's spra field (bits 13-15). spra 6 is variable:
  // a 1-byte length precedes the operand (table sprms with 2-byte lengths don't
  // occur in CHPX grpprls).
  function sprmOperandLen(sprm, buf, pos) {
    switch ((sprm >> 13) & 7) {
      case 0: case 1: return 1;
      case 2: case 4: case 5: return 2;
      case 3: return 4;
      case 7: return 3;
      case 6: return 1 + (buf[pos] || 0);
      default: return 1;
    }
  }

  // Binary-search the CHPX run containing a WordDocument byte offset.
  function runAt(runs, fc) {
    var lo = 0, hi = runs.length - 1;
    while (lo <= hi) {
      var mid = (lo + hi) >> 1;
      if (fc < runs[mid].a) hi = mid - 1;
      else if (fc >= runs[mid].b) lo = mid + 1;
      else return runs[mid];
    }
    return null;
  }

  // Tracked-deletion predicate derived from the CHPX runs.
  function makeIsDeleted(runs) {
    if (!runs || !runs.length) return null;
    return function (fc) { var r = runAt(runs, fc); return !!(r && r.p.del); };
  }

  // Font table: SttbfFfn (FibRgFcLcb97 #15) -> array of font names indexed by
  // the ftc used in sprmCRgFtc0. The STTB is "extended" (Unicode); each entry
  // is an FFN whose own cbFfnM1 byte gives its length, with the name (a null-
  // terminated UTF-16 string) at byte 40. [MS-DOC] SttbfFfn / FFN.
  function parseFonts(table, fibRgFcLcbStart, fibDv) {
    try {
      var fc = fibDv.getUint32(fibRgFcLcbStart + 15 * 8, true);
      var lcb = fibDv.getUint32(fibRgFcLcbStart + 15 * 8 + 4, true);
      if (lcb < 6 || fc < 0 || fc + lcb > table.length) return null;
      var dv = new DataView(table.buffer, table.byteOffset, table.byteLength);
      var end = fc + lcb, p = fc, cData;
      // Header: optional fExtend (0xFFFF) marker, then cData (count) + cbExtra.
      // FFN names are UTF-16 regardless; each FFN is self-sized via cbFfnM1.
      if (dv.getUint16(p, true) === 0xFFFF) { p += 2; cData = dv.getUint16(p, true); p += 4; }
      else { cData = dv.getUint16(p, true); p += 4; }
      var fonts = [];
      for (var i = 0; i < cData && p < end; i++) {
        var ffnEnd = p + table[p] + 1;                   // table[p] = cbFfnM1
        var name = '';
        for (var q = p + 40; q + 1 < ffnEnd && q + 1 < end; q += 2) {
          var ch = table[q] | (table[q + 1] << 8);
          if (ch === 0) break;
          name += String.fromCharCode(ch);
        }
        fonts.push(name);
        p = ffnEnd;
      }
      return fonts;
    } catch (e) { return null; }
  }

  // Stylesheet: STSH (Stshf at FibRgFcLcb97 #1) -> resolved character AND
  // paragraph props per style index (istd), so formatting carried by a style
  // isn't lost: a heading's bold (CHP), or — crucially — a paragraph's list
  // membership when the ilfo/ilvl live in the linked style's PAPX rather than a
  // direct sprm (the common case for Word's built-in numbered headings). Each
  // STD has a CHP grpprl, a paragraph style also a PAP grpprl (its first UPX),
  // and an istdBase parent it inherits from. Returns { chp: [...], pap: [...] }
  // indexed by istd. [MS-DOC] STSH / STSHI / STD / STDF / UPX / UpxPapx.
  function parseStsh(table, fibStart, fibDv) {
    try {
      var fc = fibDv.getUint32(fibStart + 1 * 8, true);   // #1 = fcStshf
      var lcb = fibDv.getUint32(fibStart + 1 * 8 + 4, true);
      if (lcb < 6 || fc < 0 || fc + lcb > table.length) return null;
      var dv = new DataView(table.buffer, table.byteOffset, table.byteLength);
      var end = fc + lcb;
      var cbStshi = dv.getUint16(fc, true), stshi = fc + 2;
      var cstd = dv.getUint16(stshi, true);               // STSHI.cstd
      var cbBase = dv.getUint16(stshi + 2, true);         // STSHI.cbSTDBaseInFile
      var p = stshi + cbStshi;                            // -> rgStd
      // Pass 1: each style's own CHP grpprl, a paragraph style's PAP grpprl, and parent.
      var raw = new Array(cstd);
      for (var i = 0; i < cstd && p + 2 <= end; i++) {
        var cbStd = dv.getUint16(p, true); p += 2;
        var std = p; p += cbStd;
        if (cbStd === 0 || std + cbBase + 2 > end) { raw[i] = null; continue; }
        var word1 = dv.getUint16(std + 2, true);
        var stk = word1 & 0xF;                            // style kind (1=para,2=char), low 4 bits
        var istdBase = (word1 >> 4) & 0x0FFF;             // parent style (0xFFF = none), high 12 bits
        var cupx = dv.getUint16(std + 4, true) & 0xF;     // count of UPX, low 4 bits
        var nameAt = std + cbBase, cch = dv.getUint16(nameAt, true);
        var up = nameAt + 2 + cch * 2 + 2;                // past style name + chTerm
        var chpIdx = stk === 1 ? 1 : 0;                   // para style: PAP is 1st UPX, CHP is 2nd
        var chp = {}, pap = {};
        for (var u = 0; u < cupx && up + 2 <= std + cbStd; u++) {
          var cbUpx = dv.getUint16(up, true); up += 2;
          if (u === chpIdx) chp = parseChpGrpprl(table, up, cbUpx);
          // A paragraph style's first UPX is a UpxPapx: a 2-byte istd then grpprlPapx.
          else if (u === 0 && stk === 1 && cbUpx >= 2) pap = parsePapGrpprl(table, dv, up + 2, up + cbUpx, up + cbUpx);
          up += cbUpx; if (up & 1) up++;                  // UPXs are padded to even
        }
        raw[i] = { base: istdBase, chp: chp, pap: pap };
      }
      // Pass 2: resolve inheritance for each property set (parent props, then
      // own props) up the istdBase chain — the same layering for CHP and PAP.
      var outChp = new Array(cstd), outPap = new Array(cstd);
      function resolve(field, out, i, depth) {
        if (i == null || i < 0 || i >= cstd || !raw[i] || depth > 24) return {};
        if (out[i]) return out[i];
        var r = {}, k, base = raw[i].base !== 0x0FFF ? resolve(field, out, raw[i].base, depth + 1) : {};
        for (k in base) r[k] = base[k];
        for (k in raw[i][field]) r[k] = raw[i][field][k];
        return (out[i] = r);
      }
      for (var j = 0; j < cstd; j++) { resolve('chp', outChp, j, 0); resolve('pap', outPap, j, 0); }
      return { chp: outChp, pap: outPap };
    } catch (e) { return null; }
  }

  // Paragraph bin table: PlcfBtePapx (FibRgFcLcb97 #13) -> the paragraph style
  // index (istd) for each WordDocument byte range, so a run inherits its
  // paragraph style's character formatting (e.g. a heading's bold). We only
  // need each paragraph's istd. [MS-DOC] PlcfBtePapx / PapxFkp / PapxInFkp.
  function parsePapx(wd, table, fibStart, fibDv) {
    try {
      var fc = fibDv.getUint32(fibStart + 13 * 8, true);
      var lcb = fibDv.getUint32(fibStart + 13 * 8 + 4, true);
      if (lcb < 4 || fc < 0 || fc + lcb > table.length) return null;
      var tdv = new DataView(table.buffer, table.byteOffset, table.byteLength);
      var n = Math.floor((lcb - 4) / 8);
      if (n < 1) return null;
      var pnBase = fc + (n + 1) * 4, runs = [];
      for (var i = 0; i < n; i++) {
        var pn = tdv.getUint32(pnBase + i * 4, true) & 0x003FFFFF;
        collectPapxFkp(wd, pn * 512, runs);
      }
      runs.sort(function (x, y) { return x.a - y.a; });
      return runs;
    } catch (e) { return null; }
  }

  // Tab descriptor (TBD) fields: jc (alignment, bits 0-2) and tlc (leader, bits 3-5).
  var TAB_JC = ['left', 'center', 'right', 'decimal', 'bar'];
  var TAB_TLC = ['none', 'dot', 'hyphen', 'underscore', 'heavy', 'middot'];
  // Decode the paragraph sprms we use from a PAP grpprl (the bytes after the
  // leading istd): alignment, list membership (ilfo/ilvl), keep/break flags, the
  // table row-terminator and its column/shade/merge geometry, indents, spacing,
  // tab stops, shading and borders. Returns ONLY the keys actually present, so a
  // style's PAP layers cleanly over its parent's (an absent sprm inherits rather
  // than resetting). The same grpprl format appears in a PapxInFkp and in a
  // style's UpxPapx, so both callers share this. `dv` is a DataView over `buf`
  // (for signed reads); `cap` is the hard ceiling for variable-length reads.
  function parsePapGrpprl(buf, dv, gStart, grpEnd, cap) {
    var pp = {};
    function cv24(o) { return buf[o] | (buf[o + 1] << 8) | (buf[o + 2] << 16); }  // 24-bit COLORREF (Shd/Brc fill) at byte offset o
    for (var gp = gStart; gp + 2 <= grpEnd;) {
      var sc = buf[gp] | (buf[gp + 1] << 8), ol = sprmOperandLen(sc, buf, gp + 2);
      if (sc === 0x2403 || sc === 0x2461) pp.jc = buf[gp + 2];          // sprmPJc80 / sprmPJc
      else if (sc === 0x460B) pp.ilfo = buf[gp + 2] | (buf[gp + 3] << 8); // sprmPIlfo (list)
      else if (sc === 0x260A) pp.ilvl = buf[gp + 2];                     // sprmPIlvl (level)
      else if (sc === 0x2405) pp.keepL = buf[gp + 2];                    // sprmPFKeep (keep lines together)
      else if (sc === 0x2406) pp.keepN = buf[gp + 2];                    // sprmPFKeepFollow (keep with next)
      else if (sc === 0x2407) pp.pgBrk = buf[gp + 2];                    // sprmPFPageBreakBefore
      else if (sc === 0x2417) pp.ttp = buf[gp + 2];                      // sprmPFTtp (table-terminating paragraph = row mark)
      else if (sc === 0xC60D || sc === 0xC615) {                         // sprmPChgTabsPapx / sprmPChgTabs: custom tab stops
        var tcb = buf[gp + 2], end2 = gp + 3 + tcb, p2 = gp + 3;         // operand: cb, then PChgTabsDel[Close], then PChgTabsAdd
        if (tcb !== 255 && p2 < end2 && end2 <= cap) {                   // cb == 255 is an "ignore" sentinel
          var cDel = buf[p2]; p2 += 1 + cDel * (sc === 0xC615 ? 4 : 2);  // 0xC615's PChgTabsDelClose carries rgdxaClose too (4 bytes/entry)
          if (p2 < end2) {
            var cAdd = buf[p2]; p2 += 1;                                 // PChgTabsAdd: cTabs, then rgdxaAdd (XAS), then rgtbdAdd (TBD)
            var posB = p2, tbdB = p2 + cAdd * 2;
            if (cAdd > 0 && cAdd <= 64 && tbdB + cAdd <= end2) {
              pp.tabs = [];
              for (var ta = 0; ta < cAdd; ta++) {
                var tbd = buf[tbdB + ta];                               // TBD: jc (bits 0-2), tlc (bits 3-5)
                pp.tabs.push({ pos: dv.getInt16(posB + ta * 2, true), align: TAB_JC[tbd & 0x07] || 'left', leader: TAB_TLC[(tbd >> 3) & 0x07] || 'none' });
              }
            }
          }
        }
      }
      else if (sc === 0x840F) pp.indL = dv.getInt16(gp + 2, true);      // sprmPDxaLeft
      else if (sc === 0x840E) pp.indR = dv.getInt16(gp + 2, true);      // sprmPDxaRight
      else if (sc === 0x8411) pp.ind1 = dv.getInt16(gp + 2, true);      // sprmPDxaLeft1 (first line; <0 = hanging)
      else if (sc === 0xA413) pp.spB = dv.getInt16(gp + 2, true);       // sprmPDyaBefore
      else if (sc === 0xA414) pp.spA = dv.getInt16(gp + 2, true);       // sprmPDyaAfter
      else if (sc === 0x6412) { pp.line = dv.getInt16(gp + 2, true); pp.lineMult = buf[gp + 4] | (buf[gp + 5] << 8); } // sprmPDyaLine (LSPD)
      else if (sc === 0xD608) {                                         // sprmTDefTable: capture rgdxaCenter (column boundaries, twips)
        var tcb2 = buf[gp + 2] | (buf[gp + 3] << 8); ol = 1 + tcb2;     // 2-byte cb exception; operand bytes = cb + 1 (Word writes cb = dataLen + 1)
        var itc = buf[gp + 4];                                          // itcMac (number of columns)
        if (itc > 0 && itc < 64 && gp + 5 + (itc + 1) * 2 <= cap) {
          pp.tblw = []; for (var tt = 0; tt <= itc; tt++) pp.tblw.push(dv.getInt16(gp + 5 + tt * 2, true));
          // rgTc80 follows rgdxaCenter; each TC80 is 20 bytes and opens with tcgrf (cell-merge flags)
          var tcB = gp + 5 + (itc + 1) * 2, anyM = false, mg = [];
          for (var mc = 0; mc < itc; mc++) {
            var off = tcB + mc * 20, gf = (off + 1 < cap) ? (buf[off] | (buf[off + 1] << 8)) : 0;
            var hm = (gf & 0x0001) ? 'start' : (gf & 0x0002) ? 'cont' : null;  // fFirstMerged / fMerged
            var vm = (gf & 0x0040) ? 'restart' : (gf & 0x0020) ? 'cont' : null; // fVertRestart / fVertMerge
            if (hm || vm) anyM = true;
            mg.push((hm || vm) ? { h: hm, v: vm } : null);
          }
          if (anyM) pp.tblMerge = mg;
        }
      }
      else if (sc === 0xD612) {                                         // sprmTDefTableShd: per-cell background (Shd, 10 bytes each)
        var scb = buf[gp + 2], sn = Math.floor(scb / 10);              // 1-byte cb; cvFore is the fill (R,G,B,fAuto)
        if (sn > 0 && sn < 64 && gp + 3 + sn * 10 <= cap) { pp.tblShd = []; for (var sj = 0; sj < sn; sj++) { var so = gp + 3 + sj * 10; pp.tblShd.push(buf[so + 3] === 0 ? cv24(so) : null); } }
      }
      else if (sc === 0xC64D) {                                         // sprmPShd: paragraph background (SHDOperand: cb + Shd 10)
        var ps = gp + 3;                                                // Shd: cvFore(4) cvBack(4) ipat(2); fill is cvFore, else cvBack
        if (buf[ps + 3] === 0) pp.pShd = cv24(ps);
        else if (buf[ps + 7] === 0) pp.pShd = cv24(ps + 4);
      }
      else if (sc === 0x442D) {                                         // sprmPShd80: Shd80 (2 bytes): ipat<<10 | icoBack<<5 | icoFore
        var s80 = buf[gp + 2] | (buf[gp + 3] << 8), pcv = icoCv(s80 & 0x1F);
        if (pcv != null) pp.pShd = pcv;
      }
      else if (sc >= 0xC64E && sc <= 0xC651) {                          // sprmPBrcTop/Left/Bottom/Right (BrcOperand: cb=8 + Brc 8)
        var bt = buf[gp + 8];                                           // Brc: cv(4) dptLineWidth(1) brcType(1) +2
        if (bt && bt !== 0xFF) { (pp.pBrc = pp.pBrc || {})[['top', 'left', 'bottom', 'right'][sc - 0xC64E]] =
          { color: buf[gp + 6] === 0 ? cv24(gp + 3) : null, width: bt < 0x40 ? buf[gp + 7] / 8 : buf[gp + 7], type: bt }; }
      }
      else if (sc >= 0x6424 && sc <= 0x6427) {                          // sprmPBrcTop80/... (legacy Brc80, 4 bytes)
        var bt2 = buf[gp + 3], ico2 = buf[gp + 4];                      // Brc80: dptLineWidth, brcType, ico, flags
        if (bt2 && bt2 !== 0xFF) { (pp.pBrc = pp.pBrc || {})[['top', 'left', 'bottom', 'right'][sc - 0x6424]] =
          { color: icoCv(ico2), width: buf[gp + 2] / 8, type: bt2 }; }
      }
      gp += 2 + ol; if (ol <= 0) break;
    }
    return pp;
  }

  // One PapxFkp page: crun at byte 511, rgfc[crun+1], then rgbx[crun] (BxPap,
  // 13 bytes each; first byte is the word offset to a PapxInFkp, 0 = default).
  // Each run carries the paragraph's istd plus the sparse PAP props from its
  // grpprl (parsePapGrpprl); absent props are inherited from the istd's style.
  function collectPapxFkp(wd, pageOff, runs) {
    if (pageOff < 0 || pageOff + 512 > wd.length) return;
    var dv = new DataView(wd.buffer, wd.byteOffset, wd.byteLength);
    var crun = wd[pageOff + 511];
    if (!crun) return;
    var bxBase = pageOff + 4 * (crun + 1);
    for (var i = 0; i < crun; i++) {
      var a = dv.getUint32(pageOff + i * 4, true);
      var b = dv.getUint32(pageOff + (i + 1) * 4, true);
      if (b <= a) continue;
      var bOff = wd[bxBase + i * 13], istd = 0, pp = {};  // BxPap.bOffset
      if (bOff) {
        var papx = pageOff + bOff * 2;                    // PapxInFkp
        if (papx >= pageOff && papx < pageOff + 510) {
          var cb = wd[papx];                              // GrpPrlAndIstd starts at:
          var g = cb !== 0 ? papx + 1 : papx + 2;         // cb!=0 -> +1, else +2
          if (g + 2 <= pageOff + 512) istd = wd[g] | (wd[g + 1] << 8);
          var grpEnd = cb !== 0 ? papx + 2 * cb : papx + 2 + 2 * (wd[papx + 1] || 0);
          if (grpEnd > pageOff + 512) grpEnd = pageOff + 512;
          pp = parsePapGrpprl(wd, dv, g + 2, grpEnd, pageOff + 512);  // grpprl follows the 2-byte istd
        }
      }
      var run = { a: a, b: b, istd: istd };
      for (var k in pp) run[k] = pp[k];
      runs.push(run);
    }
  }

  // PlfLst (FibRgFcLcb #73) + PlfLfo (#74) -> ilfo (1-based) -> 'bullet'|'number'
  // from each list's level-0 number format (nfc: 23 = bullet; 0-22 = decimal/
  // roman/letters). Best-effort: missing/unreadable LVLs default to bullet.
  // A reference PLC (PlcffndRef #2 etc.): N+1 CPs — the first N are the CPs of the
  // reference characters (0x02) in the main story, the last is the doc-end lim —
  // plus N 2-byte FRD records. Returns { bodyCp: refIndex } for the N references.
  function parseRefCps(table, fibStart, fibDv, idx, dataSize) {
    try {
      var cb = dataSize || 2;   // FRD (footnote/endnote) = 2 bytes; ATRD (comments) = 30
      var fc = fibDv.getUint32(fibStart + idx * 8, true), lcb = fibDv.getUint32(fibStart + idx * 8 + 4, true);
      if (lcb < 4 + cb || fc < 0 || fc + lcb > table.length) return null;
      var n = Math.floor((lcb - 4) / (4 + cb));
      if (n < 1) return null;
      var dv = new DataView(table.buffer, table.byteOffset, table.byteLength), map = {};
      for (var i = 0; i < n; i++) map[dv.getUint32(fc + i * 4, true)] = i;
      return map;
    } catch (e) { return null; }
  }

  // Standard bookmarks: SttbfBkmk (#21, names), Plcfbkf (#22, start CPs + FBKF) and
  // Plcfbkl (#23, end CPs). Bookmark i: name = SttbfBkmk[i], start = Plcfbkf.cp[i],
  // end = Plcfbkl.cp[FBKF[i].ibkl] (the ibkl index pairs a start with its end so
  // nested/overlapping ranges resolve). Returns [{ name, start, end }] (CPs) or null.
  function parseBookmarks(table, fibStart, fibDv) {
    try {
      var dv = new DataView(table.buffer, table.byteOffset, table.byteLength), tlen = table.length;
      var sFc = fibDv.getUint32(fibStart + 21 * 8, true), sLcb = fibDv.getUint32(fibStart + 21 * 8 + 4, true);
      var fFc = fibDv.getUint32(fibStart + 22 * 8, true), fLcb = fibDv.getUint32(fibStart + 22 * 8 + 4, true);
      var lFc = fibDv.getUint32(fibStart + 23 * 8, true), lLcb = fibDv.getUint32(fibStart + 23 * 8 + 4, true);
      if (sLcb < 6 || fLcb < 12 || lLcb < 8) return null;
      if (sFc + sLcb > tlen || fFc + fLcb > tlen || lFc + lLcb > tlen) return null;
      var n = Math.floor((fLcb - 4) / 8);                       // Plcfbkf: (N+1) CPs + N FBKF(4 bytes)
      if (n < 1) return null;
      // SttbfBkmk names (extended/UTF-16 STTB: fExtend, cData, cbExtra, then cch+chars).
      var names = [], p = sFc, sEnd = sFc + sLcb;
      if (dv.getUint16(p, true) === 0xFFFF) p += 2;
      var cData = dv.getUint16(p, true); p += 2; var cbExtra = dv.getUint16(p, true); p += 2;
      for (var i = 0; i < cData && p + 2 <= sEnd; i++) {
        var cch = dv.getUint16(p, true); p += 2;
        var nm = '';
        for (var c = 0; c < cch && p + 2 <= sEnd; c++) { nm += String.fromCharCode(dv.getUint16(p, true)); p += 2; }
        p += cbExtra; names.push(nm);
      }
      var fbkfBase = fFc + (n + 1) * 4, lEnd = lFc + lLcb, out = [];
      for (i = 0; i < n; i++) {
        var startCp = dv.getInt32(fFc + i * 4, true), ibkl = dv.getUint16(fbkfBase + i * 4, true);
        var endCp = (lFc + ibkl * 4 + 4 <= lEnd) ? dv.getInt32(lFc + ibkl * 4, true) : startCp;
        out.push({ name: names[i] != null ? names[i] : '', start: startCp, end: endCp });
      }
      return out.length ? out : null;
    } catch (e) { return null; }
  }

  // PlcfHdd (#11): CPs (relative to the header document) delimiting its stories.
  // Stories 0-5 are footnote/endnote separators; then 6 per section — even/odd/
  // first page header, then even/odd/first page footer. Returns the CP array.
  function parsePlcfHdd(table, fibStart, fibDv) {
    try {
      var fc = fibDv.getUint32(fibStart + 11 * 8, true), lcb = fibDv.getUint32(fibStart + 11 * 8 + 4, true);
      if (lcb < 8 || fc < 0 || fc + lcb > table.length) return null;
      var n = Math.floor(lcb / 4), dv = new DataView(table.buffer, table.byteOffset, table.byteLength), cps = [];
      for (var i = 0; i < n; i++) cps.push(dv.getUint32(fc + i * 4, true));
      return cps;
    } catch (e) { return null; }
  }

  // Document properties from the \x05SummaryInformation stream (an [MS-OLEPS]
  // property set): title/subject/author/keywords/comments. Reads the property-set
  // offset from the header, then walks its (propId, offset) table for the VT_LPSTR
  // (or VT_LPWSTR) string values. Best-effort; returns null if absent/unreadable.
  function parseSummaryInfo(cfb) {
    try {
      var entry = cfb.byName['\x05SummaryInformation'];
      if (!entry) return null;
      var s = cfb.getStream(entry);                              // byName holds the dir entry; read its bytes
      if (!s || s.length < 48) return null;
      var dv = new DataView(s.buffer, s.byteOffset, s.byteLength);
      if (dv.getUint16(0, true) !== 0xFFFE) return null;          // byte-order mark
      var ps = dv.getUint32(44, true);                            // offset to the property set (28-byte header + 16-byte FMTID)
      if (ps + 8 > s.length) return null;
      var num = dv.getUint32(ps + 4, true);
      if (num < 1 || num > 64) return null;
      var names = { 2: 'title', 3: 'subject', 4: 'author', 5: 'keywords', 6: 'comments' }, out = {};
      for (var i = 0; i < num; i++) {
        var ent = ps + 8 + i * 8;
        if (ent + 8 > s.length) break;
        var pid = dv.getUint32(ent, true), off = ps + dv.getUint32(ent + 4, true);
        if (!names[pid] || off + 8 > s.length) continue;
        var type = dv.getUint32(off, true), cch = dv.getUint32(off + 4, true);
        if ((type !== 0x1E && type !== 0x1F) || cch < 1) continue; // VT_LPSTR / VT_LPWSTR
        var str = '';
        if (type === 0x1E) { if (off + 8 + cch > s.length) continue; for (var c = 0; c < cch - 1; c++) str += String.fromCharCode(s[off + 8 + c]); }
        else { if (off + 8 + cch * 2 > s.length) continue; for (var c2 = 0; c2 < cch - 1; c2++) str += String.fromCharCode(dv.getUint16(off + 8 + c2 * 2, true)); }
        str = str.replace(/\0+$/, '');
        if (str) out[names[pid]] = str;
      }
      return Object.keys(out).length ? out : null;
    } catch (e) { return null; }
  }

  // Floating-shape positions from PlcfspaMom (FibRgFcLcb #40): each shape's FSPA
  // bounding box (xaLeft/yaTop/xaRight/yaBottom in twips) plus its anchor CP, so the
  // demo can place a text box where the document actually puts it on the page rather
  // than at its text anchor. PLC layout: N+1 CPs (4 bytes) then N FSPA records (26).
  function parseShapes(table, fibStart, fibDv) {
    try {
      var fc = fibDv.getUint32(fibStart + 40 * 8, true), lcb = fibDv.getUint32(fibStart + 40 * 8 + 4, true);
      if (lcb < 4 + 26 || fc < 0 || fc + lcb > table.length) return null;
      var n = Math.floor((lcb - 4) / 30);
      if (n < 1) return null;
      var dv = new DataView(table.buffer, table.byteOffset, table.byteLength), base = fc + (n + 1) * 4, shapes = [];
      for (var i = 0; i < n; i++) {
        var o = base + i * 26;
        if (o + 26 > table.length) break;
        shapes.push({ cp: dv.getUint32(fc + i * 4, true), xL: dv.getInt32(o + 4, true), yT: dv.getInt32(o + 8, true), xR: dv.getInt32(o + 12, true), yB: dv.getInt32(o + 16, true) });
      }
      return shapes.length ? shapes : null;
    } catch (e) { return null; }
  }

  // A section's page setup from its SEPX (a grpprl of section sprms): margins
  // (sprmSDyaTop 0x9023 / sprmSDyaBottom 0x9024 signed; sprmSDxaLeft 0xB021 /
  // sprmSDxaRight 0xB022), page size (sprmSXaPage 0xB01F / sprmSYaPage 0xB020),
  // orientation (sprmSBOrientation 0x301D), columns (sprmSCcolumns 0x500B). Twips.
  function sepxProps(wdv, wd, fcSepx) {
    if (fcSepx === 0xFFFFFFFF || fcSepx + 2 > wd.length) return null;
    var cb = wdv.getUint16(fcSepx, true), g = fcSepx + 2, end = fcSepx + 2 + cb, p = {};
    while (g + 2 <= end && g + 4 <= wd.length) {
      var sprm = wdv.getUint16(g, true), spra = (sprm >> 13) & 7;
      var opLen = spra <= 1 ? 1 : (spra === 2 || spra === 4 || spra === 5) ? 2 : spra === 3 ? 4 : spra === 7 ? 3 : (1 + (wd[g + 2] || 0));
      if (sprm === 0x9023) p.top = wdv.getInt16(g + 2, true);
      else if (sprm === 0x9024) p.bottom = wdv.getInt16(g + 2, true);
      else if (sprm === 0xB021) p.left = wdv.getUint16(g + 2, true);
      else if (sprm === 0xB022) p.right = wdv.getUint16(g + 2, true);
      else if (sprm === 0xB01F) p.width = wdv.getUint16(g + 2, true);
      else if (sprm === 0xB020) p.height = wdv.getUint16(g + 2, true);
      else if (sprm === 0x301D) p.landscape = wd[g + 2] === 2;
      else if (sprm === 0x500B) p.cols = wdv.getUint16(g + 2, true) + 1;  // sprmSCcolumns (ccolM1)
      g += 2 + opLen; if (opLen <= 0) break;
    }
    return Object.keys(p).length ? p : null;
  }
  // Every section's page setup (PlcfSed #6: (n+1) CPs then n 12-byte SEDs, each
  // SED.fcSepx -> a SEPX in the WordDocument). One entry per section (null for an
  // unreadable one); a single-section document gives a 1-element array.
  function parseSections(table, fibStart, fibDv, wd) {
    try {
      var sedFc = fibDv.getUint32(fibStart + 6 * 8, true), sedLcb = fibDv.getUint32(fibStart + 6 * 8 + 4, true);
      if (sedLcb < 16) return null;
      var n = Math.floor((sedLcb - 4) / 16);
      if (n < 1) return null;
      var tdv = new DataView(table.buffer, table.byteOffset, table.byteLength);
      var wdv = new DataView(wd.buffer, wd.byteOffset, wd.byteLength), base = sedFc + (n + 1) * 4, out = [];
      for (var si = 0; si < n; si++) out.push(sepxProps(wdv, wd, tdv.getUint32(base + si * 12 + 2, true)));
      return out;
    } catch (e) { return null; }
  }

  // ---- list-marker synthesis ([MS-DOC] LSTF/LVL number formats) -----------
  // Word keeps a list item's marker ("1." / "a)" / "i." / "•") in the list
  // definition, not the text stream, so it has to be regenerated from the
  // level's number-format code (nfc) and number-text template while counting
  // items per level. nfc: 0 decimal, 1/2 upper/lower roman, 3/4 upper/lower
  // letter, 23 bullet, 0xFF none; the rest fall back to decimal.
  function romanNum(n, upper) {
    if (n <= 0 || n >= 4000) return String(n);
    var t = [['M', 1000], ['CM', 900], ['D', 500], ['CD', 400], ['C', 100], ['XC', 90], ['L', 50], ['XL', 40], ['X', 10], ['IX', 9], ['V', 5], ['IV', 4], ['I', 1]], s = '';
    for (var i = 0; i < t.length; i++) while (n >= t[i][1]) { s += t[i][0]; n -= t[i][1]; }
    return upper ? s : s.toLowerCase();
  }
  function letterNum(n, upper) {   // 1->A, 26->Z, 27->AA (bijective base 26)
    var s = ''; while (n > 0) { var r = (n - 1) % 26; s = String.fromCharCode((upper ? 65 : 97) + r) + s; n = (n - r - 1) / 26; }
    return s || String(n);
  }
  function fmtNum(n, nfc) {
    if (!Number.isFinite(n) || n < 0 || n > 100000) return String(n);
    if (nfc === 1) return romanNum(n, true);
    if (nfc === 2) return romanNum(n, false);
    if (nfc === 3) return letterNum(n, true);
    if (nfc === 4) return letterNum(n, false);
    return String(n);              // decimal and every non-bullet fallback
  }
  function bulletGlyph(tmpl) {     // the bullet level's template is the glyph char
    var c = (tmpl && tmpl.length) ? tmpl[0] : 0x2022;
    if (c === 0x6F || c === 0xF06F) return 'o';                  // hollow / 'o' bullet
    if (c === 0xA7 || c === 0xF0A7 || c === 0xF0A8) return '▪'; // small square
    if (c === 0x2D || c === 0x2013 || c === 0x2014) return '–'; // dash
    return '•';               // round bullet — the common Word/Wingdings default
  }
  // Stateful counter: mark(ilfo, ilvl) returns the next marker at that level and
  // advances the counters, restarting deeper levels (so 1, 1.1, 1.2, 2, 2.1 …).
  function makeListNumberer(defsByIlfo) {
    var state = {};
    function startOf(x) { return (x && x.startAt != null) ? x.startAt : 1; }   // a level's start value (default 1)
    return function (ilfo, ilvl) {
      var defs = defsByIlfo && defsByIlfo[ilfo];
      if (!defs) return '';
      var st = state[ilfo] || (state[ilfo] = { counters: [], started: [] });
      var d = defs[ilvl] || defs[defs.length - 1];
      if (st.started[ilvl]) st.counters[ilvl] = (st.counters[ilvl] | 0) + 1;
      else { st.counters[ilvl] = startOf(d); st.started[ilvl] = true; }
      for (var k = ilvl + 1; k < 9; k++) st.started[k] = false;   // deeper levels restart on next use
      if (!d || d.nfc === 0xFF) return '';                        // msonfcNone
      if (d.nfc === 23) return bulletGlyph(d.tmpl);               // bullet
      var out = '';
      for (var ci = 0; ci < d.tmpl.length; ci++) {
        var ch = d.tmpl[ci];
        if (ch < 9) {              // placeholder: substitute level `ch`'s number (its own nfc)
          var lc = (st.counters[ch] != null) ? st.counters[ch] : startOf(defs[ch]);
          out += fmtNum(lc, (defs[ch] || d).nfc);
        } else out += String.fromCharCode(ch);
      }
      return out;
    };
  }
  // Read PlfLst + PlfLfo into { kind: {ilfo->'number'|'bullet'}, defs: {ilfo->[
  // {nfc, startAt, tmpl}]} }. tmpl is the LVL number text (placeholder chars 0..8
  // reference a level's number; everything else is literal). Best-effort -> null.
  function parseListDefs(table, fibStart, fibDv) {
    try {
      var lstFc = fibDv.getUint32(fibStart + 73 * 8, true), lstLcb = fibDv.getUint32(fibStart + 73 * 8 + 4, true);
      var lfoFc = fibDv.getUint32(fibStart + 74 * 8, true), lfoLcb = fibDv.getUint32(fibStart + 74 * 8 + 4, true);
      if (!lstLcb || !lfoLcb || lstFc + lstLcb > table.length || lfoFc + lfoLcb > table.length) return null;
      var dv = new DataView(table.buffer, table.byteOffset, table.byteLength);
      var cLst = dv.getUint16(lstFc, true), p = lstFc + 2, lsts = [];
      for (var i = 0; i < cLst; i++) { lsts.push({ lsid: dv.getInt32(p, true), simple: table[p + 26] & 1 }); p += 28; }
      var defsByLsid = {};
      for (i = 0; i < cLst; i++) {
        var nLvl = lsts[i].simple ? 1 : 9, levels = [];
        for (var lv = 0; lv < nLvl && p + 28 <= table.length; lv++) {   // LVLs follow rgLstf contiguously, often past lcbPlcfLst
          var startAt = dv.getInt32(p, true), nfc = table[p + 4];
          var cchOff = p + 28 + table[p + 24] + table[p + 25];   // skip LVLF(28) + grpprlChpx + grpprlPapx
          var cch = (cchOff + 2 <= table.length) ? dv.getUint16(cchOff, true) : 0, tmpl = [];
          for (var t = 0; t < cch && cchOff + 4 + t * 2 <= table.length; t++) tmpl.push(dv.getUint16(cchOff + 2 + t * 2, true));
          levels.push({ nfc: nfc, startAt: startAt, tmpl: tmpl });
          p = cchOff + 2 + cch * 2;
        }
        defsByLsid[lsts[i].lsid] = levels;
      }
      var cLfo = dv.getUint32(lfoFc, true), q = lfoFc + 4, kind = {}, defs = {};
      for (i = 0; i < cLfo && q + 16 <= lfoFc + lfoLcb; i++) {
        var levs = defsByLsid[dv.getInt32(q, true)];
        if (levs) { defs[i + 1] = levs; kind[i + 1] = (levs[0] && levs[0].nfc < 23) ? 'number' : 'bullet'; }
        q += 16;
      }
      return { kind: kind, defs: defs };
    } catch (e) { return null; }
  }

  // Extract the text of one CP range [lo, hi): the body uses [0, ccpText) and
  // each trailing story (footnotes, headers, ...) its own range. Pieces are in
  // CP order (PlcPcd aCP is sorted), so we take each piece's overlap with the
  // range. Decodes, strips field codes/control marks, and drops any chars whose
  // WordDocument offset is in a tracked-deletion range (isDeleted).
  function extractRange(wd, pieces, lo, hi, isDeleted, paraIsTtp, paraList, listDefs) {
    if (hi <= lo) return '';
    var out = [];
    var fieldStack = []; // per open field: true while inside its instruction
    var listNum = makeListNumberer(listDefs);   // per-range list counters
    var atParaStart = true;                      // the next emitted char begins a paragraph
    function startPara(fc) {                     // prepend this list item's synthesized marker
      if (!atParaStart) return;
      atParaStart = false;
      if (!paraList || fieldStack.length) return;
      var li = paraList(fc); if (!li) return;
      var mk = listNum(li.ilfo, li.ilvl); if (mk) out.push(mk + ' ');
    }

    for (var i = 0; i < pieces.length; i++) {
      var pc = pieces[i];
      var a = lo > pc.cpStart ? lo : pc.cpStart;
      var b = hi < pc.cpEnd ? hi : pc.cpEnd;
      if (a >= b) continue;
      var start = a - pc.cpStart; // first char index within this piece
      var count = b - a;

      if (pc.compressed) {
        var base = pc.offset + start;
        for (var k = 0; k < count; k++) {
          if (isDeleted && isDeleted(base + k)) continue; // tracked-change deletion
          var byte = wd[base + k];
          if (byte === undefined) break;
          var c8 = byte < 0x80 ? byte : (byte <= 0x9F ? FC_COMPRESSED_MAP[byte - 0x80] : byte);
          startPara(base + k); emit(out, fieldStack, c8, base + k, paraIsTtp);
          if (c8 === 0x0D) atParaStart = true;
        }
      } else {
        var u = pc.offset + start * 2;
        for (var m = 0; m < count; m++) {
          if (isDeleted && isDeleted(u + m * 2)) continue; // tracked-change deletion
          var loB = wd[u + m * 2];
          if (loB === undefined) break;
          var c16 = loB | ((wd[u + m * 2 + 1] || 0) << 8);
          startPara(u + m * 2); emit(out, fieldStack, c16, u + m * 2, paraIsTtp);
          if (c16 === 0x0D) atParaStart = true;
        }
      }
    }
    return out.join('');
  }

  // ---- styled HTML output ([MS-DOC] character formatting) -----------------
  // Old Word 16-colour palette for sprmCIco (0=auto, 1=black -> default text).
  var ICO_PALETTE = ['', '', 'blue', 'cyan', 'lime', 'magenta', 'red', 'yellow',
    'white', 'navy', 'teal', 'green', 'purple', 'maroon', 'olive', 'gray', 'silver'];
  // The same 16-colour palette as COLORREF ints (0x00BBGGRR) for the paragraph
  // model, so a model run carries an ico colour the same way it carries an sprmCCv
  // one. Indices 0/1 (auto/black) stay 0 = "default text colour, don't store".
  var ICO_CV = [0, 0, 0xFF0000, 0xFFFF00, 0x00FF00, 0xFF00FF, 0x0000FF, 0x00FFFF,
    0xFFFFFF, 0x800000, 0x808000, 0x008000, 0x800080, 0x000080, 0x008080, 0x808080, 0xC0C0C0];
  // A palette index (1..16) -> its COLORREF; null for auto/black sentinels (0/1) or out of range.
  function icoCv(i) { return (i > 1 && i <= 16 && ICO_CV[i]) ? ICO_CV[i] : null; }
  // sprmCKul (underline) kind -> CSS text-decoration-style, for non-plain underlines.
  var UL_STYLE = { 3: 'double', 4: 'dotted', 7: 'dashed', 9: 'dashed', 10: 'dashed', 11: 'wavy', 20: 'wavy', 23: 'dashed' };

  function escHtml(s) {
    return s.replace(/[&<>]/g, function (c) { return c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;'; });
  }

  // Resolved character props -> inline CSS ('' for default formatting).
  function styleCss(p) {
    if (!p) return '';
    var css = '';
    if (p.b) css += 'font-weight:bold;';
    if (p.i) css += 'font-style:italic;';
    var deco = '';
    if (p.u) deco += 'underline ';
    if (p.strike || p.dstrike) deco += 'line-through ';
    if (deco) css += 'text-decoration:' + deco.trim() + ';';
    if (p.dstrike) css += 'text-decoration-style:double;';                              // sprmCFDStrike: double strikethrough
    else if (p.u && UL_STYLE[p.u]) css += 'text-decoration-style:' + UL_STYLE[p.u] + ';';  // double / dotted / dashed / wavy
    if (p.smallCaps) css += 'font-variant:small-caps;';
    if (p.caps) css += 'text-transform:uppercase;';
    if (p.hidden) css += 'opacity:0.5;';                                      // hidden text (sprmCFVanish) — dimmed, not dropped
    var sup = p.iss === 1, sub = p.iss === 2;                                 // super/subscript: raise/lower and shrink
    if (sup) css += 'vertical-align:super;';
    else if (sub) css += 'vertical-align:sub;';
    else if (p.hpsPos) css += 'vertical-align:' + (p.hpsPos / 2).toFixed(1) + 'pt;';  // sprmCHpsPos: exact raise/lower, no resize
    if (p.dxaSpace) css += 'letter-spacing:' + (p.dxaSpace / 20).toFixed(1) + 'pt;';  // sprmCDxaSpace: expanded/condensed
    if (p.hps) css += 'font-size:' + ((sup || sub) ? (p.hps / 2 * 0.67).toFixed(1) : (p.hps / 2)) + 'pt;';
    else if (sup || sub) css += 'font-size:smaller;';
    if (p.font) css += "font-family:'" + p.font.replace(/['\\<>]/g, '') + "';";
    var col = colorOf(p);
    if (col) css += 'color:' + col + ';';
    if (p.highlightIco > 1 && p.highlightIco < ICO_PALETTE.length && ICO_PALETTE[p.highlightIco]) css += 'background-color:' + ICO_PALETTE[p.highlightIco] + ';';  // sprmCHighlight
    return css;
  }
  function colorOf(p) {
    if (p.cv != null && (p.cv & 0xFFFFFF) !== 0) {
      return 'rgb(' + (p.cv & 0xFF) + ',' + ((p.cv >> 8) & 0xFF) + ',' + ((p.cv >> 16) & 0xFF) + ')';
    }
    if (p.ico != null && p.ico > 1 && p.ico < ICO_PALETTE.length) return ICO_PALETTE[p.ico];
    return '';
  }

  // Like extractRange, but wraps styled text runs in <span> (HTML-escaped).
  // Structural marks stay bare — \t between table cells, \n at row/paragraph
  // breaks — so the caller can build <table>/<p>. resolve(fc) returns the
  // resolved character props for the char at WordDocument offset fc.
  function extractRangeStyled(wd, pieces, lo, hi, isDeleted, resolve) {
    if (hi <= lo) return '';
    var out = [], buf = '', curCss = null, fieldStack = [], cells = 0;
    function flushRun() {
      if (!buf) return;
      out.push(curCss ? '<span style="' + curCss + '">' + escHtml(buf) + '</span>' : escHtml(buf));
      buf = '';
    }
    function flushCells() { if (!cells) return; flushRun(); out.push(cells === 1 ? '\t' : '\n'); cells = 0; }
    function feed(code, fc) {
      if (code === 0x13) { flushCells(); fieldStack.push(true); return; }
      if (code === 0x14) { flushCells(); if (fieldStack.length) fieldStack[fieldStack.length - 1] = false; return; }
      if (code === 0x15) { flushCells(); if (fieldStack.length) fieldStack.pop(); return; }
      for (var i = 0; i < fieldStack.length; i++) if (fieldStack[i]) return;
      if (code === 0x07) { cells++; return; }
      flushCells();
      var ch = mapChar(code);
      if (ch === '') return;
      if (ch === '\n' || ch === '\t') { flushRun(); out.push(ch); return; }
      var css = resolve ? styleCss(resolve(fc)) : '';
      if (css !== curCss) { flushRun(); curCss = css; }
      buf += ch;
    }
    for (var i = 0; i < pieces.length; i++) {
      var pc = pieces[i];
      var a = lo > pc.cpStart ? lo : pc.cpStart;
      var b = hi < pc.cpEnd ? hi : pc.cpEnd;
      if (a >= b) continue;
      var start = a - pc.cpStart, count = b - a;
      if (pc.compressed) {
        var base = pc.offset + start;
        for (var k = 0; k < count; k++) {
          var fc = base + k;
          if (isDeleted && isDeleted(fc)) continue;
          var byte = wd[fc]; if (byte === undefined) break;
          feed(byte < 0x80 ? byte : (byte <= 0x9F ? FC_COMPRESSED_MAP[byte - 0x80] : byte), fc);
        }
      } else {
        var u = pc.offset + start * 2;
        for (var m = 0; m < count; m++) {
          var fc2 = u + m * 2;
          if (isDeleted && isDeleted(fc2)) continue;
          var loB = wd[fc2]; if (loB === undefined) break;
          feed(loB | ((wd[fc2 + 1] || 0) << 8), fc2);
        }
      }
    }
    flushCells(); flushRun();
    return out.join('');
  }

  // Structured model for the writer (textToDoc): the same styled runs the HTML
  // output is built from, but preserving the table cell/row marks the text and
  // HTML flatten. Returns an array of paragraphs:
  //   { runs: [{ text, b, i, u, strike, size, font, color }], kind }
  // where kind is 'p' (normal paragraph), 'cell' (table cell, more cells follow
  // in the row) or 'rowEnd' (last cell of a table row). size is in points;
  // color is a COLORREF int (0x00BBGGRR) or null.
  function extractRangeModel(wd, pieces, lo, hi, isDeleted, resolve, images, imgCtr, paraAlign, data, paraList, paraPP, paraRow, listDefs, footnoteRefs, endnoteRefs, commentRefs, textboxRefs) {
    var paras = [], runs = [], buf = '', curKey = null, curProps = null, fieldStack = [], lastCellPara = null;
    var listNum = makeListNumberer(listDefs);   // per-range list counters (body item markers)
    var instr = '', inInstr = false, curUrl = null; // hyperlink field: instruction text + the URL it yields
    var EMPTY = { b: false, i: false, u: false, strike: false, size: null, font: null, color: null, va: null, highlight: null, uStyle: null, smallCaps: false, caps: false, hidden: false, dstrike: false, spacing: null, position: null };
    function props(p) {
      var color = null;
      if (p.cv != null && (p.cv & 0xFFFFFF) !== 0) color = p.cv & 0xFFFFFF; // already 0x00BBGGRR
      var va = p.iss === 1 ? 'super' : p.iss === 2 ? 'sub' : null;          // sprmCSs
      var hl = icoCv(p.highlightIco); // sprmCHighlight ico -> COLORREF
      return { b: !!p.b, i: !!p.i, u: !!p.u, strike: !!p.strike, size: p.hps ? p.hps / 2 : null, font: p.font || null, color: color, va: va, highlight: hl, uStyle: (p.u && UL_STYLE[p.u]) || null, smallCaps: !!p.smallCaps, caps: !!p.caps, hidden: !!p.hidden, dstrike: !!p.dstrike, spacing: p.dxaSpace ? p.dxaSpace / 20 : null, position: p.hpsPos ? p.hpsPos / 2 : null };
    }
    function key(pp) { return pp.b + '|' + pp.i + '|' + pp.u + '|' + pp.strike + '|' + pp.size + '|' + pp.font + '|' + pp.color + '|' + pp.va + '|' + pp.highlight + '|' + pp.uStyle + '|' + pp.smallCaps + '|' + pp.caps + '|' + pp.hidden + '|' + pp.dstrike + '|' + pp.spacing + '|' + pp.position; }
    // A HYPERLINK field instruction is `HYPERLINK "addr" [switches]`; the address
    // is the first quoted token (or first bare token for an unquoted URL).
    function parseHyperlink(s) {
      var m = /HYPERLINK\s+(.*)/i.exec(s); if (!m) return null;
      var q = /"([^"]+)"/.exec(m[1]); if (q) return q[1];
      var t = /(\S+)/.exec(m[1]); return t ? t[1] : null;
    }
    function flushRun() { if (buf) { var r = { text: buf, b: curProps.b, i: curProps.i, u: curProps.u, strike: curProps.strike, size: curProps.size, font: curProps.font, color: curProps.color }; if (curProps.va) r.va = curProps.va; if (curProps.highlight != null) r.highlight = curProps.highlight; if (curProps.uStyle) r.uStyle = curProps.uStyle; if (curProps.smallCaps) r.smallCaps = true; if (curProps.caps) r.caps = true; if (curProps.hidden) r.hidden = true; if (curProps.dstrike) r.dstrike = true; if (curProps.spacing != null) r.spacing = curProps.spacing; if (curProps.position != null) r.position = curProps.position; if (curUrl) r.url = curUrl; runs.push(r); buf = ''; } }
    function endPara(kind, fc, tblw, tblShd, tblMerge) { flushRun(); var pp = (paraPP && fc != null) ? paraPP(fc) : null; var par = { runs: runs, kind: kind, align: (paraAlign && fc != null) ? paraAlign(fc) : 0, list: (paraList && fc != null) ? paraList(fc) : null }; if (kind === 'p' && par.list) par.list.marker = listNum(par.list.ilfo, par.list.ilvl); if (pp) par.pp = pp; if (tblw) par.tblw = tblw; if (tblShd) par.tblShd = tblShd; if (tblMerge) par.tblMerge = tblMerge; paras.push(par); runs = []; curKey = null; curProps = null; }
    // Each cell mark (0x07) closes one cell; the row's terminator mark (sprmPFTtp)
    // promotes that row's last cell to the rowEnd and attaches the column boundaries /
    // shading / merge from the terminator's PAPX. Emitting per-mark (rather than counting
    // consecutive marks) keeps empty cells as real, empty cells instead of collapsing
    // the row or splitting it in two.
    function endCellMark(fc) {
      var row = paraRow ? paraRow(fc) : null;         // one PAPX lookup per cell mark
      if (row && row.ttp) {                           // row terminator: close the row
        buf = ''; runs = []; curKey = null; curProps = null;   // the terminator paragraph itself is empty
        if (lastCellPara && lastCellPara.kind === 'cell') {
          lastCellPara.kind = 'rowEnd';
          if (row.tblw) lastCellPara.tblw = row.tblw; if (row.tblShd) lastCellPara.tblShd = row.tblShd; if (row.tblMerge) lastCellPara.tblMerge = row.tblMerge;
        } else {
          endPara('rowEnd', null, row.tblw, row.tblShd, row.tblMerge);       // defensive: a row with no preceding cell
        }
        lastCellPara = null;
      } else {                                        // ordinary cell mark
        endPara('cell', null);
        lastCellPara = paras[paras.length - 1];
      }
    }
    function feed(code, fc, cp) {
      // A footnote reference (0x02) whose CP is listed in PlcffndRef: record an
      // anchor run so the writer can re-place it and re-link the footnote text.
      if (code === 0x02 && footnoteRefs && footnoteRefs[cp] != null) { flushRun(); runs.push({ ftnRef: footnoteRefs[cp] }); curKey = null; return; }
      if (code === 0x02 && endnoteRefs && endnoteRefs[cp] != null) { flushRun(); runs.push({ endRef: endnoteRefs[cp] }); curKey = null; return; }
      if (code === 0x05 && commentRefs && commentRefs[cp] != null) { flushRun(); runs.push({ comRef: commentRefs[cp] }); curKey = null; return; }
      if (code === 0x08 && textboxRefs && textboxRefs[cp] != null) { flushRun(); runs.push({ tbxRef: textboxRefs[cp] }); curKey = null; return; }
      // Field marks. For a top-level field we collect the instruction text (so a
      // HYPERLINK URL can be recovered) and tag the result runs with the URL.
      if (code === 0x13) { flushRun(); fieldStack.push(true); if (fieldStack.length === 1) { inInstr = true; instr = ''; curKey = null; } return; }
      if (code === 0x14) { if (fieldStack.length) fieldStack[fieldStack.length - 1] = false; if (fieldStack.length === 1) { inInstr = false; curUrl = parseHyperlink(instr); curKey = null; } return; }
      if (code === 0x15) { flushRun(); if (fieldStack.length) fieldStack.pop(); if (fieldStack.length === 0) { curUrl = null; curKey = null; } return; }
      for (var i = 0; i < fieldStack.length; i++) if (fieldStack[i]) { if (inInstr) { var ic = mapChar(code); if (ic) instr += ic; } return; }
      if (code === 0x07) { endCellMark(fc); return; }
      if (code === 0x0A || code === 0x0B || code === 0x0C || code === 0x0D) { endPara('p', fc); return; }
      // picture placeholder (0x01): emit an image run, paired in order with the
      // carved images, plus the picture's display size from its PICF (dxaGoal/
      // dyaGoal, via sprmCPicLocation) so the writer can re-embed at that size.
      if (code === 0x01 && images && imgCtr && imgCtr.n < images.length) {
        flushRun();
        var img = images[imgCtr.n++], pl = resolve ? resolve(fc).picLoc : null;
        if (data && pl != null && pl + 32 <= data.length) { var pv = new DataView(data.buffer, data.byteOffset, data.byteLength); img.dxa = pv.getInt16(pl + 0x1C, true); img.dya = pv.getInt16(pl + 0x1E, true); }
        runs.push({ image: img });
        return;
      }
      var ch = mapChar(code);
      if (ch === '') return;
      var pp = resolve ? props(resolve(fc)) : EMPTY;
      var kk = key(pp);
      if (kk !== curKey) { flushRun(); curKey = kk; curProps = pp; }
      buf += ch;
    }
    for (var i = 0; i < pieces.length; i++) {
      var pc = pieces[i];
      var a = lo > pc.cpStart ? lo : pc.cpStart, b = hi < pc.cpEnd ? hi : pc.cpEnd;
      if (a >= b) continue;
      var start = a - pc.cpStart, count = b - a;
      if (pc.compressed) {
        var base = pc.offset + start;
        for (var k = 0; k < count; k++) {
          var fc = base + k; if (isDeleted && isDeleted(fc)) continue;
          var byte = wd[fc]; if (byte === undefined) break;
          feed(byte < 0x80 ? byte : (byte <= 0x9F ? FC_COMPRESSED_MAP[byte - 0x80] : byte), fc, a + k);
        }
      } else {
        var u = pc.offset + start * 2;
        for (var m = 0; m < count; m++) {
          var fc2 = u + m * 2; if (isDeleted && isDeleted(fc2)) continue;
          var loB = wd[fc2]; if (loB === undefined) break;
          feed(loB | ((wd[fc2 + 1] || 0) << 8), fc2, a + m);
        }
      }
    }
    if (buf || runs.length) endPara('p');
    return paras;
  }

  // Field markers ([MS-DOC] "Special Characters"): 0x13 begin, 0x14 separator,
  // 0x15 end. Text in the instruction region (0x13..0x14) is the field code ->
  // dropped; the result region (0x14..0x15) is kept. Nesting is tracked with a
  // stack so a nested field inside an outer instruction is dropped too.
  //
  // Table cell marks: every cell ends with a 0x07, and the row's terminator
  // paragraph (sprmPFTtp) adds one more. Each cell mark becomes a tab; the
  // terminator becomes a newline (rewriting the row's trailing tab), so empty
  // cells stay as empty columns instead of collapsing or splitting the row.
  function emit(out, fieldStack, code, fc, isTtp) {
    if (code === 0x13) { fieldStack.push(true); return; }
    if (code === 0x14) { if (fieldStack.length) fieldStack[fieldStack.length - 1] = false; return; }
    if (code === 0x15) { if (fieldStack.length) fieldStack.pop(); return; }
    for (var i = 0; i < fieldStack.length; i++) {
      if (fieldStack[i]) return; // inside some field's instruction
    }
    if (code === 0x07) {
      if (isTtp && isTtp(fc)) { if (out.length && out[out.length - 1] === '\t') out.pop(); out.push('\n'); }
      else out.push('\t');
      return;
    }
    var ch = mapChar(code);
    if (ch !== '') out.push(ch);
  }

  // Map a decoded character to output text. Structural control marks become
  // whitespace; special placeholders are dropped.
  function mapChar(code) {
    switch (code) {
      // 0x07 (cell mark) is handled as a run in emit()/flushCells(), not here.
      case 0x09: return '\t';     // tab
      case 0x0A: return '\n';     // line feed
      case 0x0B: return '\n';     // manual line break (Shift+Enter)
      case 0x0C: return '\n';     // page/section break
      case 0x0D: return '\n';     // paragraph mark
      case 0x1E: return '-';      // non-breaking hyphen
      case 0x1F: return '';       // optional (soft) hyphen
      case 0xA0: return ' '; // non-breaking space
      case 0x0001: return '';     // embedded object / picture placeholder
      case 0x0002: return '';     // auto-numbered footnote reference
      case 0x0003: return '';     // short horizontal line (rare)
      case 0x0004: return '';     // reserved
      case 0x0005: return '';     // annotation reference
      case 0x0008: return '';     // drawn object anchor
    }
    if (code < 0x20) return '';   // drop any other control character
    return String.fromCharCode(code);
  }

  // ---- helpers ------------------------------------------------------------
  function toUint8(input) {
    if (input == null) return null;
    if (input instanceof Uint8Array) return input; // also covers Node Buffer
    if (typeof ArrayBuffer !== 'undefined' && input instanceof ArrayBuffer) {
      return new Uint8Array(input);
    }
    if (input.buffer && typeof input.byteLength === 'number') {
      return new Uint8Array(input.buffer, input.byteOffset || 0, input.byteLength);
    }
    return null;
  }

  function concat(chunks, limit) {
    var total = 0, i;
    for (i = 0; i < chunks.length; i++) total += chunks[i].length;
    if (limit != null && limit < total) total = limit;
    var out = new Uint8Array(total);
    var pos = 0;
    for (i = 0; i < chunks.length && pos < total; i++) {
      var ch = chunks[i];
      var take = Math.min(ch.length, total - pos);
      out.set(take === ch.length ? ch : ch.subarray(0, take), pos);
      pos += take;
    }
    return out;
  }

  return docToText;
}));
