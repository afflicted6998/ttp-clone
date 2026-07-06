import { useEffect, useState } from "react";
import { supabase } from "./supabase";

interface CalendarEvent {
  id: string;
  title: string | null;
  description: string | null;
  starts_at: string | null;
}

interface DogOption {
  id: string;
  name: string;
  client_id: string;
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
  const [dogs, setDogs] = useState<DogOption[]>([]);
  const [pickedDogIds, setPickedDogIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Registered dogs (CRM, Phase 3). RLS scopes walkers to dogs of clients
    // they serve; admins/owner see all. Empty list = the free-text label
    // flow, unchanged from Phase 1.
    supabase
      .from("dogs")
      .select("id, name, client_id")
      .eq("active", true)
      .order("name")
      .then(({ data }) => setDogs(data ?? []));
  }, []);

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
    const picked = dogs.filter((d) => pickedDogIds.includes(d.id));
    // client_id only when every picked dog belongs to the same client —
    // correct by construction, never guessed. dog_label always carries the
    // display names (legacy consumers + the report's fallback path).
    const clientIds = [...new Set(picked.map((d) => d.client_id))];
    const label = picked.length > 0 ? picked.map((d) => d.name).join(" and ") : dogLabel.trim() || null;
    const { data: visit, error } = await supabase
      .from("visits")
      .insert({
        walker_id: walkerId,
        calendar_event_id: eventId || null,
        dog_label: label,
        client_id: clientIds.length === 1 ? clientIds[0] : null,
        status: "active",
        check_in_time: new Date().toISOString(),
      })
      .select("id")
      .single();
    if (error || !visit) {
      setBusy(false);
      setError(error?.message ?? "check-in failed");
      return;
    }
    if (picked.length > 0) {
      const { error: junctionErr } = await supabase
        .from("visit_dogs")
        .insert(picked.map((d) => ({ visit_id: visit.id, dog_id: d.id })));
      // Junction failure downgrades to the label bridge, never blocks the
      // walk — but say so, loudly.
      if (junctionErr) setError(`dogs not linked (walk still active): ${junctionErr.message}`);
    }
    setBusy(false);
    onCheckedIn();
  }

  function toggleDog(id: string) {
    setPickedDogIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
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

      {dogs.length > 0 && (
        <div>
          <p style={{ marginBottom: 4 }}>Dogs on this walk</p>
          {dogs.map((d) => (
            <label key={d.id} style={{ display: "inline-block", marginRight: 12 }}>
              <input
                type="checkbox"
                checked={pickedDogIds.includes(d.id)}
                onChange={() => toggleDog(d.id)}
              />{" "}
              {d.name}
            </label>
          ))}
        </div>
      )}

      {pickedDogIds.length === 0 && (
        <label>
          {dogs.length > 0 ? "…or unregistered dog(s), free text" : "Dog"}
          <input
            value={dogLabel}
            onChange={(e) => setDogLabel(e.target.value)}
            placeholder="e.g. Slushy"
          />
        </label>
      )}

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
