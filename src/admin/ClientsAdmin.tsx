import { useCallback, useEffect, useState } from "react";
import { supabase } from "../supabase";
import { blankToNull, nullToBlank } from "../formUtils";
import { saveCard } from "../stripeClient";

interface ClientRow {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  home_access_notes: string | null;
  notes: string | null;
  active: boolean;
  card_on_file: boolean;
}

const EMPTY: Omit<ClientRow, "id"> = {
  full_name: "",
  email: null,
  phone: null,
  address: null,
  home_access_notes: null,
  notes: null,
  active: true,
  card_on_file: false,
};

// Admin-only (enforced by RLS "clients admin all"; the UI is gated by
// useRole upstream). Plain styling on purpose — the brand pass is a
// deferred Phase 3 decision (ROADMAP pending-decisions).
export function ClientsAdmin() {
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [editing, setEditing] = useState<ClientRow | (Omit<ClientRow, "id"> & { id?: string }) | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cardBusyId, setCardBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from("clients")
      .select("id, full_name, email, phone, address, home_access_notes, notes, active, card_on_file")
      .order("full_name");
    if (error) setError(error.message);
    else setClients(data ?? []);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function save() {
    if (!editing) return;
    if (!editing.full_name.trim()) {
      setError("Name is required");
      return;
    }
    setBusy(true);
    setError(null);
    const row = {
      full_name: editing.full_name.trim(),
      email: blankToNull(nullToBlank(editing.email)),
      phone: blankToNull(nullToBlank(editing.phone)),
      address: blankToNull(nullToBlank(editing.address)),
      home_access_notes: blankToNull(nullToBlank(editing.home_access_notes)),
      notes: blankToNull(nullToBlank(editing.notes)),
      active: editing.active,
      updated_at: new Date().toISOString(),
    };
    const q = editing.id
      ? supabase.from("clients").update(row).eq("id", editing.id)
      : supabase.from("clients").insert(row);
    const { error } = await q;
    setBusy(false);
    if (error) setError(error.message);
    else {
      setEditing(null);
      load();
    }
  }

  // Opens Stripe's hosted card-save page. card_on_file flips true via the
  // webhook once the client finishes, so we tell the admin to expect that
  // rather than optimistically flipping it here.
  async function startSaveCard(clientId: string) {
    setCardBusyId(clientId);
    setError(null);
    const { data, error } = await saveCard(clientId);
    setCardBusyId(null);
    if (error || !data) {
      setError(error ?? "could not start card save");
      return;
    }
    window.open(data.url, "_blank", "noopener");
  }

  if (editing) {
    const e = editing;
    const set = (patch: Partial<ClientRow>) => setEditing({ ...e, ...patch });
    return (
      <div className="card">
        <h3>{e.id ? "Edit client" : "New client"}</h3>
        <label>
          Name *
          <input value={e.full_name} onChange={(ev) => set({ full_name: ev.target.value })} />
        </label>
        <label>
          Email
          <input value={nullToBlank(e.email)} onChange={(ev) => set({ email: ev.target.value })} />
        </label>
        <label>
          Phone
          <input value={nullToBlank(e.phone)} onChange={(ev) => set({ phone: ev.target.value })} />
        </label>
        <label>
          Address
          <textarea rows={2} value={nullToBlank(e.address)} onChange={(ev) => set({ address: ev.target.value })} />
        </label>
        <label>
          Home access (keys / lockbox / gate — sensitive)
          <textarea
            rows={2}
            value={nullToBlank(e.home_access_notes)}
            onChange={(ev) => set({ home_access_notes: ev.target.value })}
          />
        </label>
        <label>
          Notes
          <textarea rows={2} value={nullToBlank(e.notes)} onChange={(ev) => set({ notes: ev.target.value })} />
        </label>
        <label>
          <input
            type="checkbox"
            checked={e.active}
            onChange={(ev) => set({ active: ev.target.checked })}
          />{" "}
          Active
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
      <h3>Clients ({clients.length})</h3>
      <button onClick={() => setEditing({ ...EMPTY })}>+ New client</button>
      {error && <p className="error">{error}</p>}
      {clients.map((c) => (
        <p key={c.id}>
          <a
            href="#"
            onClick={(ev) => {
              ev.preventDefault();
              setEditing(c);
            }}
          >
            {c.full_name}
          </a>
          {!c.active && <span className="muted"> (inactive)</span>}
          {c.phone && <span className="muted"> · {c.phone}</span>}
          {c.card_on_file ? (
            <span className="muted"> · card on file ✓</span>
          ) : (
            <>
              {" "}
              <button
                className="secondary"
                disabled={cardBusyId === c.id}
                onClick={() => startSaveCard(c.id)}
              >
                {cardBusyId === c.id ? "Opening…" : "Save card"}
              </button>
            </>
          )}
        </p>
      ))}
      {clients.length === 0 && <p className="muted">No clients yet.</p>}
    </div>
  );
}
