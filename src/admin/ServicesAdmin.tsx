import { useCallback, useEffect, useState } from "react";
import { supabase } from "../supabase";
import { blankToNull, nullToBlank } from "../formUtils";
import { centsToDollars, dollarsToCents } from "../money";

interface ServiceRow {
  id: string;
  name: string;
  description: string | null;
  duration_minutes: number;
  price_cents: number;
  active: boolean;
  sort_order: number;
}

type Draft = Omit<ServiceRow, "id" | "price_cents"> & { id?: string; price: string };

const EMPTY: Draft = {
  name: "",
  description: null,
  duration_minutes: 30,
  price: "",
  active: true,
  sort_order: 0,
};

// Admin-only service catalog (RLS "services admin all"). Each row is a priced
// offering a booking references; the Stripe pre-payment gate (issue #40) reads
// price_cents to auto-charge, so prices live here, not typed per-invoice-line.
// Money in/out goes through money.ts — parseFloat on prices is the cents bug
// the routing table calls a trust-killer.
export function ServicesAdmin() {
  const [services, setServices] = useState<ServiceRow[]>([]);
  const [editing, setEditing] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from("services")
      .select("id, name, description, duration_minutes, price_cents, active, sort_order")
      .order("sort_order")
      .order("name");
    if (error) setError(error.message);
    else setServices(data ?? []);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function save() {
    if (!editing) return;
    if (!editing.name.trim()) {
      setError("Name is required");
      return;
    }
    const cents = dollarsToCents(editing.price);
    if (cents === null) {
      setError("Price must be a dollar amount, e.g. 28 or 28.50");
      return;
    }
    if (!Number.isInteger(editing.duration_minutes) || editing.duration_minutes <= 0) {
      setError("Duration must be a whole number of minutes");
      return;
    }
    setBusy(true);
    setError(null);
    const row = {
      name: editing.name.trim(),
      description: blankToNull(nullToBlank(editing.description)),
      duration_minutes: editing.duration_minutes,
      price_cents: cents,
      active: editing.active,
      sort_order: editing.sort_order,
      updated_at: new Date().toISOString(),
    };
    const q = editing.id
      ? supabase.from("services").update(row).eq("id", editing.id)
      : supabase.from("services").insert(row);
    const { error } = await q;
    setBusy(false);
    if (error) setError(error.message);
    else {
      setEditing(null);
      load();
    }
  }

  function edit(s: ServiceRow) {
    setEditing({
      id: s.id,
      name: s.name,
      description: s.description,
      duration_minutes: s.duration_minutes,
      price: centsToDollars(s.price_cents).replace(/^\$/, ""),
      active: s.active,
      sort_order: s.sort_order,
    });
  }

  if (editing) {
    const e = editing;
    const set = (patch: Partial<Draft>) => setEditing({ ...e, ...patch });
    return (
      <div className="card">
        <h3>{e.id ? `Edit ${e.name}` : "New service"}</h3>
        <label>
          Name * (e.g. "30-minute walk")
          <input value={e.name} onChange={(ev) => set({ name: ev.target.value })} />
        </label>
        <label>
          Description
          <input value={nullToBlank(e.description)} onChange={(ev) => set({ description: ev.target.value })} />
        </label>
        <label>
          Duration (minutes)
          <input
            type="number"
            min={1}
            value={e.duration_minutes}
            onChange={(ev) => set({ duration_minutes: Number(ev.target.value) })}
          />
        </label>
        <label>
          Price *
          <input placeholder="28.00" value={e.price} onChange={(ev) => set({ price: ev.target.value })} />
        </label>
        <label>
          Sort order
          <input
            type="number"
            value={e.sort_order}
            onChange={(ev) => set({ sort_order: Number(ev.target.value) })}
          />
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
      <h3>Services ({services.length})</h3>
      <button onClick={() => setEditing({ ...EMPTY })}>+ New service</button>
      {error && <p className="error">{error}</p>}
      {services.map((s) => (
        <p key={s.id}>
          <a
            href="#"
            onClick={(ev) => {
              ev.preventDefault();
              edit(s);
            }}
          >
            {s.name}
          </a>
          <span className="muted">
            {" "}
            · {centsToDollars(s.price_cents)} · {s.duration_minutes} min
          </span>
          {!s.active && <span className="muted"> (inactive)</span>}
        </p>
      ))}
      {services.length === 0 && (
        <p className="muted">No services yet. Add your walk types and prices — bookings charge from these.</p>
      )}
    </div>
  );
}
