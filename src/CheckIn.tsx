import { useEffect, useState } from "react";
import { supabase } from "./supabase";

interface CalendarEvent {
  id: string;
  title: string | null;
  description: string | null;
  starts_at: string | null;
}

export function CheckIn({
  walkerId,
  onCheckedIn,
}: {
  walkerId: string;
  onCheckedIn: () => void;
}) {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [eventId, setEventId] = useState<string>(""); // "" = ad-hoc walk, no appointment
  const [dogLabel, setDogLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Today's non-cancelled appointments, local time. Ad-hoc walks (no
    // calendar match) are explicitly allowed — QA calendar edge case.
    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date();
    dayEnd.setHours(23, 59, 59, 999);
    supabase
      .from("calendar_events")
      .select("id, title, description, starts_at")
      .is("cancelled_at", null)
      .gte("starts_at", dayStart.toISOString())
      .lte("starts_at", dayEnd.toISOString())
      .order("starts_at")
      .then(({ data, error }) => {
        if (error) setError(`calendar load: ${error.message}`);
        else setEvents(data ?? []);
      });
  }, []);

  async function checkIn() {
    setBusy(true);
    setError(null);
    const { error } = await supabase.from("visits").insert({
      walker_id: walkerId,
      calendar_event_id: eventId || null,
      dog_label: dogLabel.trim() || null,
      status: "active",
      check_in_time: new Date().toISOString(),
    });
    setBusy(false);
    if (error) setError(error.message);
    else onCheckedIn();
  }

  const selected = events.find((e) => e.id === eventId);

  return (
    <div className="card">
      <h2>Check in</h2>

      <label>
        Today's appointment
        <select value={eventId} onChange={(e) => setEventId(e.target.value)}>
          <option value="">Ad-hoc walk (no appointment)</option>
          {events.map((e) => (
            <option key={e.id} value={e.id}>
              {e.starts_at ? timeOf(e.starts_at) : "?"} — {e.title ?? "(untitled)"}
            </option>
          ))}
        </select>
      </label>
      {selected?.description && (
        <p className="muted" style={{ whiteSpace: "pre-wrap" }}>{selected.description}</p>
      )}

      <label>
        Dog
        <input
          value={dogLabel}
          onChange={(e) => setDogLabel(e.target.value)}
          placeholder="e.g. Slushy"
        />
      </label>

      <button onClick={checkIn} disabled={busy}>
        {busy ? "Checking in…" : "Check in"}
      </button>
      {error && <p className="error">{error}</p>}
      <p className="muted">
        GPS is recorded by Traccar Client, not this app — confirm its status
        screen shows sends before you pocket the phone.
      </p>
    </div>
  );
}

function timeOf(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}
