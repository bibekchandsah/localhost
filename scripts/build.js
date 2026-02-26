/**
 * build.js  —  unified build + icon injection script
 *
 * Strategy:
 *   1. Generate a proper multi-size ICO from the favicon PNGs.
 *   2. Run pkg normally to produce a working LocalHost.exe.
 *   3. Use resedit (pure-JS PE resource editor) to inject the custom icon.
 *      resedit stores all bytes beyond the PE sections as `extraData` and
 *      reattaches them after modifying resources, preserving the pkg snapshot.
 *   4. If the PE section resize shifts the overlay by D bytes, patch the
 *      PAYLOAD_POSITION / PRELUDE_POSITION constants that pkg embedded.
 */

const { execSync } = require('child_process');
const { NtExecutable, NtExecutableResource, Resource, Data } = require('resedit');
const path = require('path');
const fs   = require('fs');

const ROOT = path.resolve(__dirname, '..');

// ── 1. Generate multi-size ICO ───────────────────────────────────────────────

const faviconDir = path.join(ROOT, 'client', 'favicon');
const icoPath    = path.join(ROOT, 'dist', 'app-icon.ico');

fs.mkdirSync(path.dirname(icoPath), { recursive: true });

const sources = [
  { file: 'favicon-16x16.png', byte: 16 },
  { file: 'favicon-32x32.png', byte: 32 },
  { file: 'favicon-96x96.png', byte: 0  }, // 0 = 256-class high-res
];

const entries = sources.map(s => ({
  byte: s.byte,
  data: fs.readFileSync(path.join(faviconDir, s.file)),
}));

const ICONDIR_SIZE      = 6;
const ICONDIRENTRY_SIZE = 16;
const headerSize        = ICONDIR_SIZE + ICONDIRENTRY_SIZE * entries.length;

let offset = headerSize;
entries.forEach(e => { e.offset = offset; offset += e.data.length; });

const icoBuf = Buffer.alloc(offset);
icoBuf.writeUInt16LE(0, 0);
icoBuf.writeUInt16LE(1, 2);
icoBuf.writeUInt16LE(entries.length, 4);
entries.forEach((e, i) => {
  const b = ICONDIR_SIZE + i * ICONDIRENTRY_SIZE;
  icoBuf.writeUInt8(e.byte, b);      icoBuf.writeUInt8(e.byte, b + 1);
  icoBuf.writeUInt8(0, b + 2);       icoBuf.writeUInt8(0, b + 3);
  icoBuf.writeUInt16LE(1,             b + 4);
  icoBuf.writeUInt16LE(32,            b + 6);
  icoBuf.writeUInt32LE(e.data.length, b + 8);
  icoBuf.writeUInt32LE(e.offset,      b + 12);
});
entries.forEach(e => e.data.copy(icoBuf, e.offset));

fs.writeFileSync(icoPath, icoBuf);
console.log('ICO generated:', entries.map(e => `${e.byte || '96->256'}px`).join(', '));

// ── 2. Build with pkg ────────────────────────────────────────────────────────

const exePath = path.join(ROOT, 'dist', 'LocalHost.exe');
const pkgBin  = path.join(ROOT, 'node_modules', '.bin', 'pkg');

console.log('\nRunning pkg...');
execSync(`"${pkgBin}" . --compress GZip --output dist/LocalHost.exe`, {
  cwd: ROOT, stdio: 'inherit',
});

// ── 3. Inject icon with resedit (preserves extraData / pkg snapshot) ─────────

console.log('\nInjecting custom icon...');
const exeBufBefore = fs.readFileSync(exePath);
const sizeBefore   = exeBufBefore.length;

const exe = NtExecutable.from(exeBufBefore, { ignoreCert: true });
const res = NtExecutableResource.from(exe);

const iconFile           = Data.IconFile.from(icoBuf);
const iconImageDataArray = iconFile.icons.map(icon => icon.data);
Resource.IconGroupEntry.replaceIconsForResource(
  res.entries, 1, 1033, iconImageDataArray
);

res.outputResource(exe);
let newPEBuf = Buffer.from(exe.generate());
const sizeAfter = newPEBuf.length;
const D         = sizeAfter - sizeBefore;

console.log(`PE size delta: ${D >= 0 ? '+' : ''}${D} bytes`);

// ── 4. Fix PAYLOAD_POSITION / PRELUDE_POSITION if overlay shifted ────────────

if (D !== 0) {
  // pkg stores these as left-justified decimal strings padded with spaces
  // matching the original placeholder lengths:
  //   '// PAYLOAD_POSITION //' = 22 chars
  //   '// PRELUDE_POSITION //' = 23 chars  (note: one extra space somewhere)
  // We scan only the first 45 MB (Node.js binary region) to stay safe.
  const PADS = [22, 23];
  const SCAN_END = Math.min(newPEBuf.length, 45 * 1024 * 1024);
  const RANGE_LOW  = 40 * 1024 * 1024;
  const RANGE_HIGH = 50 * 1024 * 1024;
  let patched = 0;

  for (let i = 0; i < SCAN_END; i++) {
    if (newPEBuf[i] < 0x30 || newPEBuf[i] > 0x39) continue; // not a digit

    for (const padLen of PADS) {
      if (i + padLen > SCAN_END) continue;
      let numEnd = i;
      while (numEnd < i + padLen && newPEBuf[numEnd] >= 0x30 && newPEBuf[numEnd] <= 0x39) numEnd++;
      if (numEnd === i) continue; // no digits
      const allSpaces = newPEBuf.slice(numEnd, i + padLen).every(b => b === 0x20);
      if (!allSpaces) continue;

      const oldVal = parseInt(newPEBuf.slice(i, numEnd).toString(), 10);
      if (oldVal < RANGE_LOW || oldVal > RANGE_HIGH) continue;

      const newVal = oldVal + D;
      newPEBuf.write(newVal.toString().padEnd(padLen, ' '), i, padLen, 'ascii');
      console.log(`  Patched position ${i}: ${oldVal} -> ${newVal}`);
      patched++;
      i += padLen - 1; // skip ahead past this match
      break;
    }
  }
  if (patched === 0) {
    console.warn('  Warning: could not find any PAYLOAD/PRELUDE positions to patch!');
    console.warn('  The exe may not start. Try rebuilding if it fails.');
  }
}

fs.writeFileSync(exePath, newPEBuf);
console.log(`\nDone! -> dist/LocalHost.exe (${(newPEBuf.length / 1024 / 1024).toFixed(1)} MB)`);
