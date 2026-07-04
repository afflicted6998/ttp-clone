import { parseCalendar } from "./parse.ts";
import assert from "node:assert";

// Shaped like a real Google Calendar secret-address feed: VTIMEZONE block,
// TZID-relative times, a plain event, and a weekly recurring event with one
// cancelled instance (EXDATE) and one rescheduled instance (RECURRENCE-ID).
const FEED = [
  "BEGIN:VCALENDAR",
  "PRODID:-//Google Inc//Google Calendar 70.9054//EN",
  "VERSION:2.0",
  "BEGIN:VTIMEZONE",
  "TZID:America/New_York",
  "BEGIN:DAYLIGHT",
  "TZOFFSETFROM:-0500",
  "TZOFFSETTO:-0400",
  "TZNAME:EDT",
  "DTSTART:19700308T020000",
  "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU",
  "END:DAYLIGHT",
  "BEGIN:STANDARD",
  "TZOFFSETFROM:-0400",
  "TZOFFSETTO:-0500",
  "TZNAME:EST",
  "DTSTART:19701101T020000",
  "RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU",
  "END:STANDARD",
  "END:VTIMEZONE",
  // One-off walk appointment
  "BEGIN:VEVENT",
  "UID:oneoff123@google.com",
  "DTSTART;TZID=America/New_York:20260708T140000",
  "DTEND;TZID=America/New_York:20260708T150000",
  "SUMMARY:Max — midday walk",
  "DESCRIPTION:Gate code 4417. Reactive to bikes.",
  "LOCATION:123 Fake St\\, Bethesda MD",
  "END:VEVENT",
  // Weekly walk, 4 occurrences, Jul 13 cancelled, Jul 20 moved to 2pm
  "BEGIN:VEVENT",
  "UID:weekly456@google.com",
  "DTSTART;TZID=America/New_York:20260706T100000",
  "DTEND;TZID=America/New_York:20260706T103000",
  "RRULE:FREQ=WEEKLY;COUNT=4",
  "EXDATE;TZID=America/New_York:20260713T100000",
  "SUMMARY:Slushy — weekly walk",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:weekly456@google.com",
  "RECURRENCE-ID;TZID=America/New_York:20260720T100000",
  "DTSTART;TZID=America/New_York:20260720T140000",
  "DTEND;TZID=America/New_York:20260720T143000",
  "SUMMARY:Slushy — weekly walk (moved to 2pm)",
  "END:VEVENT",
  // Far outside the window — must not appear
  "BEGIN:VEVENT",
  "UID:faraway789@google.com",
  "DTSTART;TZID=America/New_York:20270101T100000",
  "DTEND;TZID=America/New_York:20270101T110000",
  "SUMMARY:Next year",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

const rows = parseCalendar(
  FEED,
  new Date("2026-07-01T00:00:00Z"),
  new Date("2026-08-31T00:00:00Z"),
);

let n = 0;
function check(name: string, fn: () => void) {
  n++;
  fn();
  console.log(`ok ${n} - ${name}`);
}

check("one-off + 3 surviving recurring instances, out-of-window excluded", () => {
  assert.equal(rows.length, 4, JSON.stringify(rows.map((r) => r.ics_uid), null, 2));
  assert(!rows.some((r) => r.ics_uid.startsWith("faraway789")));
});

check("one-off event fields land intact (EDT 2pm = 18:00 UTC)", () => {
  const r = rows.find((r) => r.ics_uid === "oneoff123@google.com");
  assert(r, "one-off row present, keyed by bare UID");
  assert.equal(r!.title, "Max — midday walk");
  assert.equal(r!.description, "Gate code 4417. Reactive to bikes.");
  assert.equal(r!.location, "123 Fake St, Bethesda MD");
  assert.equal(r!.starts_at, "2026-07-08T18:00:00.000Z");
  assert.equal(r!.ends_at, "2026-07-08T19:00:00.000Z");
});

check("recurring instances get distinct composite uids", () => {
  const weekly = rows.filter((r) => r.ics_uid.startsWith("weekly456@google.com:"));
  assert.equal(weekly.length, 3);
  assert.equal(new Set(weekly.map((r) => r.ics_uid)).size, 3);
});

check("EXDATE instance (Jul 13) is not emitted", () => {
  assert(!rows.some((r) => r.starts_at.startsWith("2026-07-13")));
});

check("moved instance uses new time/title but original recurrence id", () => {
  const moved = rows.find((r) => r.title?.includes("moved to 2pm"));
  assert(moved, "edited instance present with exception title");
  assert.equal(moved!.starts_at, "2026-07-20T18:00:00.000Z"); // 2pm EDT, the NEW time
  assert(
    moved!.ics_uid.includes("10:00"),
    `uid keeps originally-scheduled time for stable upserts, got: ${moved!.ics_uid}`,
  );
});

check("untouched recurring instances at original 10am EDT", () => {
  const plain = rows
    .filter((r) => r.title === "Slushy — weekly walk")
    .map((r) => r.starts_at)
    .sort();
  assert.deepEqual(plain, ["2026-07-06T14:00:00.000Z", "2026-07-27T14:00:00.000Z"]);
});

check("raw_ics keeps the original VEVENT block", () => {
  const r = rows.find((r) => r.ics_uid === "oneoff123@google.com")!;
  assert(r.raw_ics.includes("BEGIN:VEVENT"));
  assert(r.raw_ics.includes("Gate code 4417"));
});

console.log(`\n${n} tests passed`);
