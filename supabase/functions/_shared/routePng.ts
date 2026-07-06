// Self-rendered walk-route PNG for the report-card email (issue #25 ruling:
// no external static-map service — no account, no key, no rate limit on the
// send path). Pure module: runs on Deno (edge) and Node ≥18 (tsx tests) —
// nothing here may touch Deno.* or node:* APIs. CompressionStream provides
// the zlib stream PNG requires on both runtimes.
//
// The output is a route trace on a plain background (polyline + start/end
// markers), not a street map — the email pairs it with a "view in app" link
// to the real Leaflet map. Street-tile backgrounds are a Report Card
// Aesthetics upgrade (ROADMAP pending-decisions), not gate scope.

export interface LatLng {
  latitude: number;
  longitude: number;
}

interface Rgb {
  r: number;
  g: number;
  b: number;
}

// Brand colors (PROJECT_CONTEXT Phase 2 brand system).
const ROUTE = { r: 0x22, g: 0x63, b: 0x46 }; // Moss Trail
const END = { r: 0xfb, g: 0x79, b: 0x39 };   // Trail Marker
const BG = { r: 0xff, g: 0xff, b: 0xff };

// ---------------------------------------------------------------- raster ---

function stampDisc(
  rgb: Uint8Array,
  width: number,
  height: number,
  cx: number,
  cy: number,
  radius: number,
  color: Rgb,
): void {
  const x0 = Math.max(0, Math.floor(cx - radius));
  const x1 = Math.min(width - 1, Math.ceil(cx + radius));
  const y0 = Math.max(0, Math.floor(cy - radius));
  const y1 = Math.min(height - 1, Math.ceil(cy + radius));
  const r2 = radius * radius;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy <= r2) {
        const i = (y * width + x) * 3;
        rgb[i] = color.r;
        rgb[i + 1] = color.g;
        rgb[i + 2] = color.b;
      }
    }
  }
}

/**
 * Project GPS points into pixel space and draw the route. Returns raw RGB
 * (3 bytes/pixel) so tests can assert on pixels without decoding a PNG.
 *
 * Projection: equirectangular with cos(mid-latitude) x-correction — plenty
 * for walk-sized extents — fitted into the padded canvas preserving aspect.
 */
export function rasterizeRoute(
  points: LatLng[],
  width = 600,
  height = 400,
  pad = 24,
): Uint8Array {
  const rgb = new Uint8Array(width * height * 3);
  for (let i = 0; i < rgb.length; i += 3) {
    rgb[i] = BG.r;
    rgb[i + 1] = BG.g;
    rgb[i + 2] = BG.b;
  }
  if (points.length === 0) return rgb;

  const midLat =
    points.reduce((s, p) => s + p.latitude, 0) / points.length;
  const xScale = Math.cos((midLat * Math.PI) / 180);
  const xs = points.map((p) => p.longitude * xScale);
  const ys = points.map((p) => -p.latitude); // north = up
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  // Zero-extent guard (single point / stationary walk): any positive span
  // works — everything lands on the center.
  const spanX = Math.max(maxX - minX, 1e-9);
  const spanY = Math.max(maxY - minY, 1e-9);
  const scale = Math.min((width - 2 * pad) / spanX, (height - 2 * pad) / spanY);
  // Center-based mapping: bbox midpoint → canvas midpoint. Degenerates
  // gracefully — a single stationary point lands exactly at the center.
  const midX = (minX + maxX) / 2;
  const midY = (minY + maxY) / 2;
  const px = (i: number) => width / 2 + (xs[i] - midX) * scale;
  const py = (i: number) => height / 2 + (ys[i] - midY) * scale;

  // Polyline: stamp small discs along each segment — no Bresenham edge
  // cases, and thickness falls out of the disc radius.
  const lineRadius = 2;
  for (let i = 0; i < points.length - 1; i++) {
    const x0 = px(i);
    const y0 = py(i);
    const x1 = px(i + 1);
    const y1 = py(i + 1);
    const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0)));
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      stampDisc(rgb, width, height, x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, lineRadius, ROUTE);
    }
  }
  // Start marker (route color, larger) and end marker (Trail Marker orange),
  // drawn last so they sit on top of the line.
  stampDisc(rgb, width, height, px(0), py(0), 6, ROUTE);
  stampDisc(rgb, width, height, px(points.length - 1), py(points.length - 1), 6, END);
  return rgb;
}

// ------------------------------------------------------------------- png ---

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function u32be(n: number): Uint8Array {
  return new Uint8Array([(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]);
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new TextEncoder().encode(type);
  const body = new Uint8Array(typeBytes.length + data.length);
  body.set(typeBytes, 0);
  body.set(data, typeBytes.length);
  const out = new Uint8Array(4 + body.length + 4);
  out.set(u32be(data.length), 0);
  out.set(body, 4);
  out.set(u32be(crc32(body)), 4 + body.length);
  return out;
}

async function zlibDeflate(data: Uint8Array): Promise<Uint8Array> {
  const cs = new CompressionStream("deflate"); // zlib-wrapped, as PNG requires
  const writer = cs.writable.getWriter();
  void writer.write(data);
  void writer.close();
  const chunks: Uint8Array[] = [];
  const reader = cs.readable.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  const total = chunks.reduce((s, c) => s + c.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

/** Encode raw RGB (3 bytes/pixel, row-major) as an 8-bit truecolor PNG. */
export async function encodePng(
  width: number,
  height: number,
  rgb: Uint8Array,
): Promise<Uint8Array> {
  if (rgb.length !== width * height * 3) {
    throw new Error(`rgb length ${rgb.length} != ${width}x${height}x3`);
  }
  // Each scanline prefixed with filter byte 0 (None).
  const raw = new Uint8Array(height * (width * 3 + 1));
  for (let y = 0; y < height; y++) {
    const rowStart = y * (width * 3 + 1);
    raw[rowStart] = 0;
    raw.set(rgb.subarray(y * width * 3, (y + 1) * width * 3), rowStart + 1);
  }
  const ihdr = new Uint8Array(13);
  ihdr.set(u32be(width), 0);
  ihdr.set(u32be(height), 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: truecolor
  // compression 0, filter 0, interlace 0 already zeroed
  const idat = await zlibDeflate(raw);
  const signature = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const parts = [
    signature,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", idat),
    pngChunk("IEND", new Uint8Array(0)),
  ];
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

/** The one-call form the edge function uses. */
export async function renderRoutePng(
  points: LatLng[],
  width = 600,
  height = 400,
): Promise<Uint8Array> {
  return encodePng(width, height, rasterizeRoute(points, width, height));
}
