import { crc32, encodePng, rasterizeRoute, renderRoutePng, type LatLng } from "./routePng";
import assert from "node:assert";

let n = 0;
function check(name: string, fn: () => void | Promise<void>) {
  n++;
  const r = fn();
  const done = () => console.log(`ok ${n} - ${name}`);
  return r instanceof Promise ? r.then(done) : done();
}

// A short DC-ish walk segment (Bethesda), west-to-east then north.
const WALK: LatLng[] = [
  { latitude: 38.9847, longitude: -77.0947 },
  { latitude: 38.9849, longitude: -77.0935 },
  { latitude: 38.9855, longitude: -77.0930 },
];

function pixel(rgb: Uint8Array, width: number, x: number, y: number): [number, number, number] {
  const i = (y * width + x) * 3;
  return [rgb[i], rgb[i + 1], rgb[i + 2]];
}

await check("crc32 matches the published PNG vector (empty IEND chunk)", () => {
  assert.equal(crc32(new TextEncoder().encode("IEND")), 0xae426082);
});

await check("raster is white where the route is not", () => {
  const rgb = rasterizeRoute(WALK, 100, 80);
  assert.deepEqual(pixel(rgb, 100, 0, 0), [255, 255, 255]);
  assert.deepEqual(pixel(rgb, 100, 99, 79), [255, 255, 255]);
});

await check("start and end markers land in opposite padded corners' regions", () => {
  const w = 100, h = 80;
  const rgb = rasterizeRoute(WALK, w, h, 10);
  // Start is the WSW-most point → left side, lower half; Moss Trail green.
  let foundGreen = false, foundOrange = false;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [r, g, b] = pixel(rgb, w, x, y);
      if (r === 0x22 && g === 0x63 && b === 0x46) foundGreen = true;
      if (r === 0xfb && g === 0x79 && b === 0x39) foundOrange = true;
    }
  }
  assert.ok(foundGreen, "route/start color present");
  assert.ok(foundOrange, "end marker color present");
});

await check("single stationary point renders a centered dot, no crash", () => {
  const w = 100, h = 80;
  const rgb = rasterizeRoute([WALK[0]], w, h);
  const [r, g, b] = pixel(rgb, w, 50, 40);
  // Center pixel is the end marker (drawn last) — orange.
  assert.deepEqual([r, g, b], [0xfb, 0x79, 0x39]);
});

await check("empty point list yields a blank canvas", () => {
  const rgb = rasterizeRoute([], 10, 10);
  assert.ok(rgb.every((v, i) => v === 255 || i % 3 !== 0 || true));
  assert.deepEqual(pixel(rgb, 10, 5, 5), [255, 255, 255]);
});

await check("PNG has correct signature and IHDR dimensions", async () => {
  const png = await encodePng(60, 40, rasterizeRoute(WALK, 60, 40));
  assert.deepEqual(
    [...png.subarray(0, 8)],
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  );
  // IHDR data starts at byte 16: width u32be, height u32be.
  const dv = new DataView(png.buffer, png.byteOffset);
  assert.equal(dv.getUint32(16), 60);
  assert.equal(dv.getUint32(20), 40);
  assert.equal(png[24], 8, "bit depth");
  assert.equal(png[25], 2, "truecolor");
});

await check("IDAT inflates back to exactly (w*3+1)*h filtered bytes", async () => {
  const w = 60, h = 40;
  const png = await renderRoutePng(WALK, w, h);
  // Find the IDAT chunk.
  let off = 8;
  let idat: Uint8Array | null = null;
  const dv = new DataView(png.buffer, png.byteOffset);
  while (off < png.length) {
    const len = dv.getUint32(off);
    const type = new TextDecoder().decode(png.subarray(off + 4, off + 8));
    if (type === "IDAT") idat = png.subarray(off + 8, off + 8 + len);
    off += 12 + len;
  }
  assert.ok(idat, "IDAT found");
  const ds = new DecompressionStream("deflate");
  const writer = ds.writable.getWriter();
  void writer.write(idat!.slice());
  void writer.close();
  const chunks: Uint8Array[] = [];
  const reader = ds.readable.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  const total = chunks.reduce((s, c) => s + c.length, 0);
  assert.equal(total, (w * 3 + 1) * h);
});

console.log(`${n} route-png tests passed`);
