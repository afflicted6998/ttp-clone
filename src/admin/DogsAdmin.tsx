import { useCallback, useEffect, useState } from "react";
import { supabase } from "../supabase";
import { blankToNull, nullToBlank } from "../formUtils";

interface DogRow {
  id: string;
  client_id: string;
  name: string;
  breed: string | null;
  behavior_notes: string | null;
  vet_name: string | null;
  vet_phone: string | null;
  medications: string | null;
  emergency_contact: string | null;
  active: boolean;
}

interface ClientOption {
  id: string;
  full_name: string;
}

const EMPTY: Omit<DogRow, "id"> = {
  client_id: "",
  name: "",
  breed: null,
  behavior_notes: null,
  vet_name: null,
  vet_phone: null,
  medications: null,
  emergency_contact: null,
  active: true,
};

// Admin-only dog profiles (RLS "dogs admin all"). These rows are what turns
// the dog_label bridge into real per-dog data at Phase 3's visit_dogs
// wiring — behavior_notes surfaces on the walk screen later.
export function DogsAdmin() {
  const [dogs, setDogs] = useState<DogRow[]>([]);
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [editing, setEditing] = useState<DogRow | (Omit<DogRow, "id"> & { id?: string }) | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [dogsRes, clientsRes] = await Promise.all([
      supabase
        .from("dogs")
        .select("id, client_id, name, breed, behavior_notes, vet_name, vet_phone, medications, emergency_contact, active")
        .order("name"),
      supabase.from("clients").select("id, full_name").order("full_name"),
    ]);
    if (dogsRes.error) setError(dogsRes.error.message);
    else setDogs(dogsRes.data ?? []);
    if (clientsRes.data) setClients(clientsRes.data);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const clientName = (id: string) => clients.find((c) => c.id === id)?.full_name ?? "?";

  async function save() {
    if (!editing) return;
    if (!editing.name.trim() || !editing.client_id) {
      setError("Name and client are required");
      return;
    }
    setBusy(true);
    setError(null);
    const row = {
      client_id: editing.client_id,
      name: editing.name.trim(),
      breed: blankToNull(nullToBlank(editing.breed)),
      behavior_notes: blankToNull(nullToBlank(editing.behavior_notes)),
      vet_name: blankToNull(nullToBlank(editing.vet_name)),
      vet_phone: blankToNull(nullToBlank(editing.vet_phone)),
      medications: blankToNull(nullToBlank(editing.medications)),
      emergency_contact: blankToNull(nullToBlank(editing.emergency_contact)),
      active: editing.active,
      updated_at: new Date().toISOString(),
    };
    const q = editing.id
      ? supabase.from("dogs").update(row).eq("id", editing.id)
      : supabase.from("dogs").insert(row);
    const { error } = await q;
    setBusy(false);
    if (error) setError(error.message);
    else {
      setEditing(null);
      load();
    }
  }

  if (editing) {
    const e = editing;
    const set = (patch: Partial<DogRow>) => setEditing({ ...e, ...patch });
    return (
      <div className="card">
        <h3>{e.id ? `Edit ${e.name}` : "New dog"}</h3>
        <label>
          Name *
          <input value={e.name} onChange={(ev) => set({ name: ev.target.value })} />
        </label>
        <label>
          Client *
          <select value={e.client_id} onChange={(ev) => set({ client_id: ev.target.value })}>
            <option value="">— pick a client —</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.full_name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Breed
          <input value={nullToBlank(e.breed)} onChange={(ev) => set({ breed: ev.target.value })} />
        </label>
        <label>
          Behavior notes (e.g. "reactive to bikes")
          <textarea
            rows={2}
            value={nullToBlank(e.behavior_notes)}
            onChange={(ev) => set({ behavior_notes: ev.target.value })}
          />
        </label>
        <label>
          Vet name
          <input value={nullToBlank(e.vet_name)} onChange={(ev) => set({ vet_name: ev.target.value })} />
        </label>
        <label>
          Vet phone
          <input value={nullToBlank(e.vet_phone)} onChange={(ev) => set({ vet_phone: ev.target.value })} />
        </label>
        <label>
          Medications
          <textarea rows={2} value={nullToBlank(e.medications)} onChange={(ev) => set({ medications: ev.target.value })} />
        </label>
        <label>
          Emergency contact
          <input
            value={nullToBlank(e.emergency_contact)}
            onChange={(ev) => set({ emergency_contact: ev.target.value })}
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
      <h3>Dogs ({dogs.length})</h3>
      <button onClick={() => setEditing({ ...EMPTY })} disabled={clients.length === 0}>
        + New dog
      </button>
      {clients.length === 0 && <p className="muted">Add a client first — every dog belongs to one.</p>}
      {error && <p className="error">{error}</p>}
      {dogs.map((d) => (
        <p key={d.id}>
          <a
            href="#"
            onClick={(ev) => {
              ev.preventDefault();
              setEditing(d);
            }}
          >
            {d.name}
          </a>
          <span className="muted">
            {" "}
            · {clientName(d.client_id)}
            {d.breed ? ` · ${d.breed}` : ""}
          </span>
          {!d.active && <span className="muted"> (inactive)</span>}
        </p>
      ))}
      {dogs.length === 0 && clients.length > 0 && <p className="muted">No dogs yet.</p>}
    </div>
  );
}
