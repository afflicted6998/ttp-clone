import { mediaTypeFor, bucketFor, storagePathFor } from "./mediaPath";
import assert from "node:assert";

let n = 0;
function check(name: string, fn: () => void) {
  n++;
  fn();
  console.log(`ok ${n} - ${name}`);
}

check("jpeg is a photo bound for visit-photos", () => {
  assert.equal(mediaTypeFor("image/jpeg"), "photo");
  assert.equal(bucketFor("photo"), "visit-photos");
});

check("mp4 is a video bound for visit-video", () => {
  assert.equal(mediaTypeFor("video/mp4"), "video");
  assert.equal(bucketFor("video"), "visit-video");
});

check("non-media mime rejected", () => {
  assert.equal(mediaTypeFor("application/pdf"), null);
  assert.equal(mediaTypeFor(""), null);
});

check("storage path is <visitId>/<ts>.<ext>", () => {
  assert.equal(
    storagePathFor("abc-123", "image/jpeg", 1751652000000),
    "abc-123/1751652000000.jpeg",
  );
});

check("mime parameters and suffixes stripped from extension", () => {
  assert.equal(
    storagePathFor("v", "video/webm;codecs=vp9", 1),
    "v/1.webm",
  );
  assert.equal(storagePathFor("v", "image/svg+xml", 2), "v/2.svg");
});

check("garbage mime still yields a usable path", () => {
  assert.equal(storagePathFor("v", "garbage", 3), "v/3.bin");
});

console.log(`\n${n} tests passed`);
