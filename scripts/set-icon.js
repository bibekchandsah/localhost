/**
 * Pre-build: generates dist/app-icon.ico — a proper multi-size ICO
 * from the existing standard-size favicon PNGs.
 * Windows Explorer shows the best-matching size; tools like rcedit
 * require at minimum a 16x16 entry to accept the ICO.
 */
const path = require('path');
const fs   = require('fs');

const faviconDir = path.join(__dirname, '../client/favicon');
const ico        = path.join(__dirname, '../dist/app-icon.ico');

fs.mkdirSync(path.dirname(ico), { recursive: true });

// Standard sizes that Windows / rcedit expect.
// 0 in the ICO header byte = 256 (high-res PNG-in-ICO, Vista+)
const sources = [
  { file: 'favicon-16x16.png', byte: 16  },
  { file: 'favicon-32x32.png', byte: 32  },
  { file: 'favicon-96x96.png', byte: 0   }, // shown as 256-class high-res
];

const entries = sources.map(s => ({
  byte: s.byte,
  data: fs.readFileSync(path.join(faviconDir, s.file)),
}));

const ICONDIR_SIZE      = 6;
const ICONDIRENTRY_SIZE = 16;
const headerSize = ICONDIR_SIZE + ICONDIRENTRY_SIZE * entries.length;

// Assign data offsets
let offset = headerSize;
entries.forEach(e => { e.offset = offset; offset += e.data.length; });

const out = Buffer.alloc(offset);

// ICONDIR
out.writeUInt16LE(0, 0);              // reserved
out.writeUInt16LE(1, 2);              // type = 1 (ICO)
out.writeUInt16LE(entries.length, 4); // image count

// ICONDIRENTRY per image
entries.forEach((e, i) => {
  const b = ICONDIR_SIZE + i * ICONDIRENTRY_SIZE;
  out.writeUInt8(e.byte,        b);      // width  (0 = 256)
  out.writeUInt8(e.byte,        b + 1);  // height (0 = 256)
  out.writeUInt8(0,             b + 2);  // colorCount
  out.writeUInt8(0,             b + 3);  // reserved
  out.writeUInt16LE(1,          b + 4);  // planes
  out.writeUInt16LE(32,         b + 6);  // bitCount
  out.writeUInt32LE(e.data.length, b + 8);  // size of PNG data
  out.writeUInt32LE(e.offset,      b + 12); // offset to PNG data
});

// Write PNG payloads
entries.forEach(e => e.data.copy(out, e.offset));

fs.writeFileSync(ico, out);
console.log(`ICO generated: ${ico}`);
entries.forEach(e => console.log(`  size=${e.byte || '256-class'}: ${e.data.length} bytes`));
