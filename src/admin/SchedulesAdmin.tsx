import { useCallback, useEffect, useState } from "react";
import { supabase } from "../supabase";
import { blankToNull, nullToBlank } from "../formUtils";
import { parseWeeklyRrule, weeklyRrule, WEEKDAYS, type Weekday } from "../rrule";

interface ClientOption {
  id: string;
  full_name: string;
}
interface StaffOption {
  id: string;
  full_name: string;
}
interface DogOption {
  id: string;
  name: string;
  client_id: string;
}

interface ScheduleRow {
  id: string;
  client_id: string;
  label: string | null;
  rrule: string;
  dtstart_local: string;
  timezone: string;
  duration_minutes: number;
  default_staff_id: string | null;
  notes: string | null;
  active: boolean;
}

// Phase 5 PREP (ruling 3): schedule templates + a manual "generate" button.
// Google Calendar ingestion still carries live scheduling — nothing here
// runs on its own until Steve rules Phase 5 activation.
export function SchedulesAdmin() {
  const [schedules, setSchedules] = useState<ScheduleRow[]>([]);
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [staff, setStaff] = useState<StaffOption[]>([]);
  const [dogs, setDogs] = useState<DogOption[]>([]);
  const [scheduleDogs, setScheduleDogs] = useState<Record<string, string[]>>({});
  const [editing, setEditing] = useState<(Omit<ScheduleRow, "id"> & { id?: string }) | null>(null);
  const [editDays, setEditDays] = useState<Weekday[]>([]);
  const [editTime, setEditTime] = useState("10:00");
  const [editFirstDay, setEditFirstDay] = useState("");
  const [editDogIds, setEditDogIds] = useState<string[]>([]);
  const [freeRrule, setFreeRrule] = useState<string | null>(null); // non-weekly escape hatch
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [genResult, setGenResult] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [schedRes, clientRes, staffRes, dogRes, sdRes] = await Promise.all([
      supabase
        .from("schedules")
        .select(
          "id, client_id, label, rrule, dtstart_local, timezone, duration_minutes, default_staff_id, notes, active",
        )
        .order("created_at"),
      supabase.from("clients").select("id, full_name").eq("active", true).order("full_name"),
      supabase.from("staff").select("id, full_name").eq("active", true).order("full_name"),
      supabase.from("dogs").select("id, name, client_id").eq("active", true).order("name"),
      supabase.from("schedule_dogs").select("schedule_id, dog_id"),
    ]);
    if (schedRes.error) setError(schedRes.error.message);
    else setSchedules(schedRes.data ?? []);
    if (clientRes.data) setClients(clientRes.data);
    if (staffRes.data) setStaff(staffRes.data);
    if (dogRes.data) setDogs(dogRes.data);
    const bySchedule: Record<string, string[]> = {};
    for (const row of sdRes.data ?? []) {
      (bySchedule[row.schedule_id] ??= []).push(row.dog_id);
    }
    setScheduleDogs(bySchedule);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function startEdit(s?: ScheduleRow) {
    if (s) {
      setEditing({ ...s });
      const parsed = parseWeeklyRrule(s.rrule);
      setFreeRrule(parsed ? null : s.rrule);
      setEditDays(parsed ?? []);
      const [d, t] = s.dtstart_local.replace(" ", "T").split("T");
      setEditFirstDay(d);
      setEditTime((t ?? "10:00").slice(0, 5));
      setEditDogIds(scheduleDogs[s.id] ?? []);
    } else {
      setEditing({
        client_id: "",
        label: null,
        rrule: "",
        dtstart_local: "",
        timezone: "America/New_York",
        duration_minutes: 30,
        default_staff_id: staff[0]?.id ?? null,
        notes: null,
        active: true,
      });
      setFreeRrule(null);
      setEditDays([]);
      setEditFirstDay(new Date().toISOString().slice(0, 10));
      setEditTime("10:00");
      setEditDogIds([]);
    }
    setGenResult(null);
    setError(null);
  }

  async function save() {
    if (!editing) return;
    if (!editing.client_id) {
      setError("Client is required");
      return;
    }
    let rrule: string;
    try {
      rrule = freeRrule !== null ? freeRrule.trim() : weeklyRrule(editDays);
    } catch (e) {
      setError((e as Error).message);
      return;
    }
    if (!editFirstDay || !/^\d{2}:\d{2}$/.test(editTime)) {
      setError("First day and time are required");
      return;
    }
    setBusy(true);
    setError(null);
    const row = {
      client_id: editing.client_id,
      label: blankToNull(nullToBlank(editing.label)),
      rrule,
      dtstart_local: `${editFirstDay}T${editTime}:00`,
      timezone: editing.timezone,
      duration_minutes: editing.duration_minutes,
      default_staff_id: editing.default_staff_id,
      notes: blankToNull(nullToBlank(editing.notes)),
      active: editing.active,
      updated_at: new Date().toISOString(),
    };
    const saved = editing.id
      ? await supabase.from("schedules").update(row).eq("id", editing.id).select("id").single()
      : await supabase.from("schedules").insert(row).select("id").single();
    if (saved.error || !saved.data) {
      setBusy(false);
      setError(saved.error?.message ?? "save failed");
      return;
    }
    // Reconcile schedule_dogs to the picked set.
    await supabase.from("schedule_dogs").delete().eq("schedule_id", saved.data.id);
    if (editDogIds.length > 0) {
      const { error: sdErr } = await supabase
        .from("schedule_dogs")
        .insert(editDogIds.map((d) => ({ schedule_id: saved.data.id, dog_id: d })));
      if (sdErr) setError(`schedule saved, dogs failed: ${sdErr.message}`);
    }
    setBusy(false);
    setEditing(null);
    load();
  }

  async function generate(scheduleId?: string) {
    setBusy(true);
    setGenResult(null);
    setError(null);
    const { data, error } = await supabase.functions.invoke("generate-visits", {
      body: { days: 14, ...(scheduleId && { schedule_id: scheduleId }) },
    });
    setBusy(false);
    if (error) setError(`generate: ${error.message}`);
    else {
      const results = (data as { results?: { label?: string; created?: number; error?: string }[] })
        ?.results ?? [];
      setGenResult(
        results
          .map((r) => (r.error ? `error: ${r.error}` : `${r.label ?? "schedule"}: +${r.created}`))
          .join(" · ") || "nothing to generate",
      );
    }
  }

  const clientName = (id: string) => clients.find((c) => c.id === id)?.full_name ?? "?";
  const clientDogs = editing ? dogs.filter((d) => d.client_id === editing.client_id) : [];

  if (editing) {
    const e = editing;
    const set = (patch: Partial<ScheduleRow>) => setEditing({ ...e, ...patch });
    return (
      <div className="card">
        <h3>{e.id ? "Edit schedule" : "New schedule"}</h3>
        <label>
          Client *
          <select
            value={e.client_id}
            onChange={(ev) => {
              set({ client_id: ev.target.value });
              setEditDogIds([]);
            }}
          >
            <option value="">— pick a client —</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.full_name}
              </option>
            ))}
          </select>
        </label>
        {clientDogs.length > 0 && (
          <div>
            <p style={{ marginBottom: 4 }}>Dogs</p>
            {clientDogs.map((d) => (
              <label key={d.id} style={{ display: "inline-block", marginRight: 12 }}>
                <input
                  type="checkbox"
                  checked={editDogIds.includes(d.id)}
                  onChange={() =>
                    setEditDogIds((ids) =>
                      ids.includes(d.id) ? ids.filter((x) => x !== d.id) : [...ids, d.id],
                    )
                  }
                />{" "}
                {d.name}
              </label>
            ))}
          </div>
        )}
        <label>
          Label
          <input
            value={nullToBlank(e.label)}
            onChange={(ev) => set({ label: ev.target.value })}
            placeholder="e.g. MWF midday walk"
          />
        </label>
        {freeRrule === null ? (
          <div>
            <p style={{ marginBottom: 4 }}>Days of the week</p>
            {WEEKDAYS.map((d) => (
              <label key={d} style={{ display: "inline-block", marginRight: 10 }}>
                <input
                  type="checkbox"
                  checked={editDays.includes(d)}
                  onChange={() =>
                    setEditDays((days) =>
                      days.includes(d) ? days.filter((x) => x !== d) : [...days, d],
                    )
                  }
                />{" "}
                {d}
              </label>
            ))}
            <p className="muted" style={{ marginTop: 4 }}>
              <a href="#" onClick={(ev) => { ev.preventDefault(); setFreeRrule(e.rrule || ""); }}>
                advanced: raw RRULE
              </a>
            </p>
          </div>
        ) : (
          <label>
            RRULE (RFC 5545)
            <input value={freeRrule} onChange={(ev) => setFreeRrule(ev.target.value)} />
          </label>
        )}
        <label>
          Time (wall clock — stays put across DST)
          <input type="time" value={editTime} onChange={(ev) => setEditTime(ev.target.value)} />
        </label>
        <label>
          First day
          <input type="date" value={editFirstDay} onChange={(ev) => setEditFirstDay(ev.target.value)} />
        </label>
        <label>
          Duration (minutes)
          <input
            type="number"
            min={5}
            value={e.duration_minutes}
            onChange={(ev) => set({ duration_minutes: Number(ev.target.value) })}
          />
        </label>
        <label>
          Default walker
          <select
            value={e.default_staff_id ?? ""}
            onChange={(ev) => set({ default_staff_id: ev.target.value || null })}
          >
            <option value="">— none —</option>
            {staff.map((s) => (
              <option key={s.id} value={s.id}>
                {s.full_name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Notes
          <textarea rows={2} value={nullToBlank(e.notes)} onChange={(ev) => set({ notes: ev.target.value })} />
        </label>
        <label>
          <input type="checkbox" checked={e.active} onChange={(ev) => set({ active: ev.target.checked })} /> Active
        </label>
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <button onClick={save} disabled={busy}>
            {busy ? "Saving…" : "Save"}
          </button>
          <button className="secondary" onClick={() => setEditing(null)} disabled={busy}>
            Cancel
          </button>
        </div>
        {error && <p className="error">{error}</p>}
      </div>
    );
  }

  return (
    <div className="card">
      <h3>Schedules ({schedules.length})</h3>
      <p className="muted">
        Phase 5 prep — Google Calendar still runs live scheduling. Generation
        is manual until the activation gate.
      </p>
      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={() => startEdit()} disabled={clients.length === 0}>
          + New schedule
        </button>
        <button className="secondary" onClick={() => generate()} disabled={busy || schedules.length === 0}>
          Generate next 14 days (all)
        </button>
      </div>
      {clients.length === 0 && <p className="muted">Add a client first.</p>}
      {genResult && <p className="muted">{genResult}</p>}
      {error && <p className="error">{error}</p>}
      {schedules.map((s) => (
        <p key={s.id}>
          <a href="#" onClick={(ev) => { ev.preventDefault(); startEdit(s); }}>
            {s.label ?? s.rrule}
          </a>
          <span className="muted">
            {" "}
            · {clientName(s.client_id)} · {s.rrule.replace("FREQ=WEEKLY;BYDAY=", "")} at{" "}
            {s.dtstart_local.replace(" ", "T").split("T")[1]?.slice(0, 5)} · {s.duration_minutes} min
          </span>
          {!s.active && <span className="muted"> (inactive)</span>}{" "}
          <button className="secondary" onClick={() => generate(s.id)} disabled={busy}>
            generate
          </button>
        </p>
      ))}
      {schedules.length === 0 && <p className="muted">No schedules yet.</p>}
    </div>
  );
}
