import {
  buildReportEmail,
  escapeHtml,
  formatDurationMin,
  metersToMiles,
  weatherLineImperial,
  type ReportData,
} from "./reportEmail";
import assert from "node:assert";

let n = 0;
function check(name: string, fn: () => void) {
  n++;
  fn();
  console.log(`ok ${n} - ${name}`);
}

const SAMSON_REBA: ReportData = {
  dogs: ["Samson", "Reba"],
  peeDogs: ["Samson", "Reba"],
  poopDogs: ["Reba"],
  visitNotes: "Reba great on the walk again. <script>alert(1)</script>",
  terrain: "brick sidewalks & mulch",
  checkInIso: "2026-07-05T17:10:00Z",
  checkOutIso: "2026-07-05T17:42:00Z",
  durationMinutes: 32,
  distanceMeters: 1930,
  weather: { tempC: 31.4, code: 3, windKmh: 12.9 },
  photoUrls: ["https://example.com/p1.jpg?sig=a&b=c"],
  videos: [{ url: "https://example.com/v1.mp4", capturedAt: "2026-07-05T17:20:00Z" }],
  appointmentTitle: "Samson, Reba (Kevin Jiles)",
  hasMap: true,
  appUrl: "https://app.example.com",
};

check("subject names all dogs", () => {
  assert.equal(buildReportEmail(SAMSON_REBA).subject, "Walk report for Samson & Reba");
});

check("per-dog cards: Samson pee-only, Reba both — checkmark logic", () => {
  const { html } = buildReportEmail(SAMSON_REBA);
  const samson = html.slice(html.indexOf(">Samson<"), html.indexOf(">Reba<"));
  const reba = html.slice(html.indexOf(">Reba<"));
  assert.equal((samson.match(/&#10003; Yes/g) ?? []).length, 1, "Samson: exactly one Yes");
  assert.equal((reba.match(/&#10003; Yes/g) ?? []).length, 2, "Reba: two Yes");
});

check("user text is HTML-escaped (notes, terrain)", () => {
  const { html } = buildReportEmail(SAMSON_REBA);
  assert.ok(!html.includes("<script>alert(1)</script>"));
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(html.includes("brick sidewalks &amp; mulch"));
});

check("stats, weather (imperial), map cid, photo, video, narrative slot all present", () => {
  const { html } = buildReportEmail(SAMSON_REBA);
  assert.ok(html.includes("32 min"));
  assert.ok(html.includes("1.20 mi"));
  assert.ok(html.includes("89°F, overcast, wind 8 mph"));
  assert.ok(html.includes('src="cid:route-map"'));
  assert.ok(html.includes("https://example.com/p1.jpg?sig=a&amp;b=c"));
  assert.ok(html.includes("https://example.com/v1.mp4"));
  assert.ok(html.includes("care-report narrative slot"));
});

check("nulls degrade cleanly: no notes/weather/map/media", () => {
  const { html, subject } = buildReportEmail({
    ...SAMSON_REBA,
    dogs: ["Slushy"],
    peeDogs: [],
    poopDogs: [],
    visitNotes: null,
    terrain: null,
    weather: null,
    photoUrls: [],
    videos: [],
    appointmentTitle: null,
    hasMap: false,
    appUrl: null,
    durationMinutes: null,
    distanceMeters: null,
  });
  assert.equal(subject, "Walk report for Slushy");
  assert.ok(!html.includes("cid:route-map"));
  assert.ok(!html.includes("Videos"));
  assert.ok(html.includes("&mdash;")); // pee/poop dashes
  assert.ok(html.includes(">—</td>")); // null duration/distance render as an em dash
});

check("helpers: duration/distance/weather formatting", () => {
  assert.equal(formatDurationMin(75), "1 h 15 min");
  assert.equal(formatDurationMin(null), "—");
  assert.equal(metersToMiles(1609.344), "1.00 mi");
  assert.equal(weatherLineImperial({ tempC: 0, code: 71, windKmh: 0 }), "32°F, snow, wind 0 mph");
  assert.equal(escapeHtml(`<a href="x">'&'</a>`), "&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;");
});

check("times render in America/New_York regardless of runtime TZ", () => {
  const { html } = buildReportEmail(SAMSON_REBA);
  assert.ok(html.includes("1:10"), "check-in 17:10Z = 1:10 PM EDT");
});

console.log(`${n} report-email tests passed`);
