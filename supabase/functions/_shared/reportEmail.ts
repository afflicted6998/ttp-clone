// Report-card email HTML — pure builder, testable on Node and Deno.
// Structure deliberately mirrors the real TTP report Steve exported
// ("TTP Example Report … Samson, Reba"): brand header → personal message →
// photos → visit report card → per-dog cards → footer. Ours adds what TTP
// never gave him: duration, distance, weather, and the route map — the
// data-ownership payoff, in the client's inbox.
//
// Unit convention: DB stores metric; client-facing display is imperial
// (°F, mph, miles — DC clients). The °F/label logic intentionally mirrors
// src/weather.ts; keep them in sync if the WMO ranges ever change.

export interface ReportVideo {
  url: string;
  capturedAt: string; // ISO
}

export interface ReportData {
  dogs: string[]; // splitDogLabel(visit.dog_label)
  peeDogs: string[];
  poopDogs: string[];
  visitNotes: string | null; // the personal message — the heart of the TTP report
  terrain: string | null;
  checkInIso: string | null;
  checkOutIso: string | null;
  durationMinutes: number | null;
  distanceMeters: number | null;
  weather: { tempC: number; code: number; windKmh: number } | null;
  photoUrls: string[];
  videos: ReportVideo[];
  appointmentTitle: string | null;
  hasMap: boolean; // true when route.png is attached as cid:route-map
  appUrl: string | null;
}

export function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function formatDurationMin(minutes: number | null): string {
  if (minutes === null || !Number.isFinite(minutes)) return "—";
  const m = Math.round(minutes);
  return m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} min` : `${m} min`;
}

export function metersToMiles(meters: number | null): string {
  if (meters === null || !Number.isFinite(meters)) return "—";
  return `${(meters / 1609.344).toFixed(2)} mi`;
}

function weatherLabel(code: number): string {
  if (code === 0) return "clear";
  if (code <= 2) return "partly cloudy";
  if (code === 3) return "overcast";
  if (code === 45 || code === 48) return "fog";
  if (code >= 51 && code <= 57) return "drizzle";
  if (code >= 61 && code <= 67) return "rain";
  if (code >= 71 && code <= 77) return "snow";
  if (code >= 80 && code <= 82) return "rain showers";
  if (code === 85 || code === 86) return "snow showers";
  if (code >= 95) return "thunderstorm";
  return "unknown";
}

export function weatherLineImperial(w: { tempC: number; code: number; windKmh: number }): string {
  const f = Math.round((w.tempC * 9) / 5 + 32);
  const mph = Math.round(w.windKmh / 1.609344);
  return `${f}°F, ${weatherLabel(w.code)}, wind ${mph} mph`;
}

// Palette: Moss Trail / Oat Cream / Trail Marker (PROJECT_CONTEXT brand system).
const GREEN = "#226346";
const ORANGE = "#FB7939";
const CREAM = "#FFF2CD";

const CHECK = `<span style="color:${GREEN};font-weight:bold">&#10003; Yes</span>`;
const DASH = `<span style="color:#999">&mdash;</span>`;

function card(inner: string): string {
  return `<div style="background:#fff;border:1px solid #e5e5e5;border-radius:10px;padding:16px;margin:12px 0">${inner}</div>`;
}

export function buildReportEmail(d: ReportData): { subject: string; html: string } {
  const dogsLabel = d.dogs.join(" & ");
  const subject = `Walk report for ${dogsLabel}`;

  const timeRange = (() => {
    if (!d.checkInIso) return "";
    const opts: Intl.DateTimeFormatOptions = {
      hour: "numeric",
      minute: "2-digit",
      timeZone: "America/New_York",
    };
    const inT = new Date(d.checkInIso).toLocaleTimeString("en-US", opts);
    const outT = d.checkOutIso ? new Date(d.checkOutIso).toLocaleTimeString("en-US", opts) : "";
    const day = new Date(d.checkInIso).toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
      timeZone: "America/New_York",
    });
    return `${day}, ${inT}${outT ? `&ndash;${outT}` : ""}`;
  })();

  const notesBlock = d.visitNotes
    ? card(`<div style="white-space:pre-wrap;font-size:15px;line-height:1.5">${escapeHtml(d.visitNotes)}</div>`)
    : "";

  const photosBlock = d.photoUrls
    .map(
      (u) =>
        `<img src="${escapeHtml(u)}" alt="walk photo" style="width:100%;border-radius:10px;margin:8px 0;display:block">`,
    )
    .join("");

  const statsRows: string[] = [];
  if (timeRange) statsRows.push(row("When", timeRange));
  statsRows.push(row("Duration", formatDurationMin(d.durationMinutes)));
  statsRows.push(row("Distance", metersToMiles(d.distanceMeters)));
  if (d.weather) statsRows.push(row("Weather", weatherLineImperial(d.weather)));
  if (d.terrain) statsRows.push(row("Terrain", escapeHtml(d.terrain)));
  if (d.appointmentTitle) statsRows.push(row("Appointment", escapeHtml(d.appointmentTitle)));
  const statsBlock = card(
    `<h3 style="margin:0 0 8px;text-align:center">Visit Report</h3><table style="width:100%;border-collapse:collapse">${statsRows.join("")}</table>`,
  );

  const mapBlock = d.hasMap
    ? card(
        `<h3 style="margin:0 0 8px;text-align:center">Route</h3>` +
          `<img src="cid:route-map" alt="walk route" style="width:100%;border-radius:8px;display:block">` +
          (d.appUrl
            ? `<p style="text-align:center;margin:8px 0 0"><a href="${escapeHtml(d.appUrl)}" style="color:${GREEN}">View the full map in the app</a></p>`
            : ""),
      )
    : "";

  const dogBlocks = d.dogs
    .map((dog) =>
      card(
        `<h3 style="margin:0 0 8px;text-align:center">${escapeHtml(dog)}</h3>` +
          `<table style="width:100%;border-collapse:collapse">` +
          row("&#128167; Pee", d.peeDogs.includes(dog) ? CHECK : DASH) +
          row("&#128169; Poop", d.poopDogs.includes(dog) ? CHECK : DASH) +
          `</table>`,
      ),
    )
    .join("");

  const videosBlock =
    d.videos.length > 0
      ? card(
          `<h3 style="margin:0 0 8px;text-align:center">Videos</h3>` +
            d.videos
              .map(
                (v) =>
                  `<p style="margin:4px 0"><a href="${escapeHtml(v.url)}" style="color:${GREEN}">&#9654; Video from ${new Date(v.capturedAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" })}</a></p>`,
              )
              .join(""),
        )
      : "";

  const html = `<!doctype html>
<html>
<body style="margin:0;padding:0;background:${CREAM}">
  <div style="max-width:600px;margin:0 auto;padding:16px;font-family:Georgia,'Times New Roman',serif;color:#222">
    <div style="border-top:4px solid ${ORANGE};background:#fff;border-radius:0 0 10px 10px;padding:24px 16px;text-align:center">
      <div style="font-size:28px;letter-spacing:3px;color:${ORANGE}">OUTSIDE FEET</div>
      <div style="font-size:11px;letter-spacing:5px;color:${GREEN};margin-top:4px">PREMIUM PET CARE</div>
    </div>
    <p style="font-size:15px">Here&rsquo;s how the walk went for <strong>${escapeHtml(dogsLabel)}</strong>.</p>
    <!-- care-report narrative slot: AI-written text plugs in here once Steve's
         voice-tuning process happens (issue #24 ruling — deferred). Until
         then the walker's own note below carries the story. -->
    ${notesBlock}
    ${photosBlock}
    ${statsBlock}
    ${mapBlock}
    ${dogBlocks}
    ${videosBlock}
    <p style="text-align:center;color:#666;font-size:12px;margin-top:24px">
      This report was sent as part of a post-visit report, from Outside Feet&rsquo;s own system.
    </p>
  </div>
</body>
</html>`;

  return { subject, html };
}

function row(label: string, value: string): string {
  return `<tr><td style="padding:4px 8px;color:#555;width:40%">${label}</td><td style="padding:4px 8px;font-weight:600">${value}</td></tr>`;
}
