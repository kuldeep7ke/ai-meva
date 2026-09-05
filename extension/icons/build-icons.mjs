/**
 * AI Meva brand icon builder (pure Node, no external tools).
 *
 * Renders the AI Meva mark - an #ff7700 rounded square with a white
 * "timeline cut + play" glyph - at every size the plugin needs:
 *
 *   icons/logo.svg          master artwork (full mark)
 *   icons/favicon.svg       simplified master (small-size legibility)
 *   icons/icon-24/48/96.png UXP manifest pluginList icons
 *   icons/logo-256/512.png  store / docs / marketplace artwork
 *   icons/favicon-16/32/48  browser / tab icons
 *   icons/favicon.ico       ICO bundle (PNG-compressed 16/32/48 entries)
 *
 * Usage: node ai-meva-plugin/icons/build-icons.mjs
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ORANGE = [0xff, 0x77, 0x00, 0xff];
const WHITE = [0xff, 0xff, 0xff, 0xff];
const CLEAR = [0, 0, 0, 0];
const SS = 4; // supersample factor for smooth edges

function rrect(px, py, x, y, w, h, r) {
  const cx = x + w / 2;
  const cy = y + h / 2;
  const qx = Math.abs(px - cx) - (w / 2 - r);
  const qy = Math.abs(py - cy) - (h / 2 - r);
  const ax = Math.max(qx, 0);
  const ay = Math.max(qy, 0);
  return Math.hypot(ax, ay) + Math.min(Math.max(qx, qy), 0) - r <= 0;
}

function tri(px, py, ax, ay, bx, by, cx, cy) {
  const s = (x1, y1, x2, y2, x3, y3) =>
    (x1 - x3) * (y2 - y3) - (x2 - x3) * (y1 - y3);
  const d1 = s(px, py, ax, ay, bx, by);
  const d2 = s(px, py, bx, by, cx, cy);
  const d3 = s(px, py, cx, cy, ax, ay);
  const neg = d1 < 0 || d2 < 0 || d3 < 0;
  const pos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(neg && pos);
}

// Full mark: timeline bars + play triangle.
function paintFull(px, py) {
  if (tri(px, py, 58, 32, 58, 64, 82, 48)) return WHITE;
  if (rrect(px, py, 21, 40, 9, 18, 3)) return WHITE;
  if (rrect(px, py, 34, 32, 9, 34, 3)) return WHITE;
  if (rrect(px, py, 47, 44, 9, 10, 3)) return WHITE;
  if (rrect(px, py, 4, 4, 88, 88, 22)) return ORANGE;
  return CLEAR;
}

// Simplified mark for tiny sizes: one cut bar + play triangle.
function paintSimple(px, py) {
  if (tri(px, py, 46, 32, 46, 64, 76, 48)) return WHITE;
  if (rrect(px, py, 22, 36, 14, 24, 4.5)) return WHITE;
  if (rrect(px, py, 4, 4, 88, 88, 22)) return ORANGE;
  return CLEAR;
}

function render(size, paint) {
  const big = size * SS;
  const acc = new Float64Array(size * size * 4);
  for (let y = 0; y < big; y++) {
    for (let x = 0; x < big; x++) {
      const px = ((x + 0.5) / SS / size) * 96;
      const py = ((y + 0.5) / SS / size) * 96;
      const c = paint(px, py);
      const i = (Math.floor(y / SS) * size + Math.floor(x / SS)) * 4;
      acc[i] += c[0];
      acc[i + 1] += c[1];
      acc[i + 2] += c[2];
      acc[i + 3] += c[3];
    }
  }
  const n = SS * SS;
  const out = Buffer.alloc(size * size * 4);
  for (let i = 0; i < size * size * 4; i++) out[i] = Math.round(acc[i] / n);
  return { size, data: out };
}

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function encodePng({ size, data }) {
  const raw = Buffer.alloc(size * (1 + size * 4));
  for (let y = 0; y < size; y++) {
    raw[y * (1 + size * 4)] = 0; // filter: none
    data.copy(raw, y * (1 + size * 4) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function encodeIco(pngs) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  const entries = [];
  let offset = 6 + 16 * pngs.length;
  for (const p of pngs) {
    const e = Buffer.alloc(16);
    e[0] = p.size >= 256 ? 0 : p.size;
    e[1] = p.size >= 256 ? 0 : p.size;
    e[4] = 1;
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(p.data.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += p.data.length;
    entries.push(e);
  }
  return Buffer.concat([header, ...entries, ...pngs.map((p) => p.data)]);
}

function svgFull() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" role="img" aria-label="AI Meva logo">\n` +
    `  <rect x="4" y="4" width="88" height="88" rx="22" fill="#ff7700"/>\n` +
    `  <rect x="21" y="40" width="9" height="18" rx="3" fill="#ffffff"/>\n` +
    `  <rect x="34" y="32" width="9" height="34" rx="3" fill="#ffffff"/>\n` +
    `  <rect x="47" y="44" width="9" height="10" rx="3" fill="#ffffff"/>\n` +
    `  <path d="M58 32 L58 64 L82 48 Z" fill="#ffffff"/>\n` +
    `</svg>\n`;
}

function svgSimple() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" role="img" aria-label="AI Meva favicon">\n` +
    `  <rect x="4" y="4" width="88" height="88" rx="22" fill="#ff7700"/>\n` +
    `  <rect x="22" y="36" width="14" height="24" rx="4.5" fill="#ffffff"/>\n` +
    `  <path d="M46 32 L46 64 L76 48 Z" fill="#ffffff"/>\n` +
    `</svg>\n`;
}

const jobs = [
  ["logo.svg", null],
  ["favicon.svg", null],
  ["icon-24.png", () => encodePng(render(24, paintFull))],
  ["icon-48.png", () => encodePng(render(48, paintFull))],
  ["icon-96.png", () => encodePng(render(96, paintFull))],
  ["logo-256.png", () => encodePng(render(256, paintFull))],
  ["logo-512.png", () => encodePng(render(512, paintFull))],
  ["favicon-16.png", () => encodePng(render(16, paintSimple))],
  ["favicon-32.png", () => encodePng(render(32, paintSimple))],
  ["favicon-48.png", () => encodePng(render(48, paintSimple))],
];

fs.writeFileSync(path.join(__dirname, "logo.svg"), svgFull());
fs.writeFileSync(path.join(__dirname, "favicon.svg"), svgSimple());
console.log("wrote logo.svg, favicon.svg");

for (const [name, make] of jobs) {
  if (!make) continue;
  const t0 = Date.now();
  fs.writeFileSync(path.join(__dirname, name), make());
  console.log(`wrote ${name} (${Date.now() - t0}ms)`);
}

const ico = encodeIco(
  [16, 32, 48].map((s) => {
    const png = encodePng(render(s, paintSimple));
    return { size: s, data: png };
  })
);
fs.writeFileSync(path.join(__dirname, "favicon.ico"), ico);
console.log("wrote favicon.ico");
