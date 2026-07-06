import { useCallback, useEffect, useState } from "react";
import { supabase } from "../supabase";
import { centsToDollars, dollarsToCents } from "../money";
import { formatDuration } from "../format";

interface ClientOption {
  id: string;
  full_name: string;
}

interface InvoiceRow {
  id: string;
  client_id: string;
  status: string;
  issue_date: string | null;
  total_cents: number;
  qb_invoice_id: string | null;
}

interface BillableVisit {
  id: string;
  dog_label: string | null;
  check_in_time: string | null;
  duration_minutes: number | null;
}

// Phase 4, the in-house half: invoice data lives here; money movement stays
// in QuickBooks (ruling 4). Prices are typed per line by the admin — a
// pricing model (per-client rate? per-duration?) is a business decision on
// the pending list, not something this screen invents. The n8n → QuickBooks
// sync arrives once Steve's Intuit developer account exists; qb_invoice_id
// stays NULL until then.
export function InvoicesAdmin() {
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  // "new invoice" flow state
  const [draftClient, setDraftClient] = useState<string>("");
  const [billable, setBillable] = useState<BillableVisit[]>([]);
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [prices, setPrices] = useState<Record<string, string>>({}); // visit id → dollars text
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [clientsRes, invoicesRes] = await Promise.all([
      supabase.from("clients").select("id, full_name").eq("active", true).order("full_name"),
      supabase
        .from("invoices")
        .select("id, client_id, status, issue_date, total_cents, qb_invoice_id")
        .order("created_at", { ascending: false })
        .limit(30),
    ]);
    if (clientsRes.data) setClients(clientsRes.data);
    if (invoicesRes.error) setError(invoicesRes.error.message);
    else setInvoices(invoicesRes.data ?? []);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Completed, not-yet-invoiced visits for the drafted client.
  useEffect(() => {
    if (!draftClient) {
      setBillable([]);
      return;
    }
    (async () => {
      const [visitsRes, linesRes] = await Promise.all([
        supabase
          .from("visits")
          .select("id, dog_label, check_in_time, duration_minutes")
          .eq("client_id", draftClient)
          .eq("status", "completed")
          .order("check_in_time"),
        supabase.from("invoice_lines").select("visit_id").not("visit_id", "is", null),
      ]);
      const invoiced = new Set((linesRes.data ?? []).map((l) => l.visit_id));
      setBillable((visitsRes.data ?? []).filter((v) => !invoiced.has(v.id)));
      setPicked({});
      setPrices({});
    })();
  }, [draftClient]);

  async function createInvoice() {
    const chosen = billable.filter((v) => picked[v.id]);
    if (chosen.length === 0) {
      setError("Pick at least one visit");
      return;
    }
    const lineCents = chosen.map((v) => dollarsToCents(prices[v.id] ?? ""));
    if (lineCents.some((c) => c === null)) {
      setError("Every picked visit needs a valid price (e.g. 24.50)");
      return;
    }
    setBusy(true);
    setError(null);
    const total = (lineCents as number[]).reduce((s, c) => s + c, 0);
    const { data: invoice, error: invErr } = await supabase
      .from("invoices")
      .insert({
        client_id: draftClient,
        status: "draft",
        issue_date: new Date().toISOString().slice(0, 10),
        subtotal_cents: total,
        tax_cents: 0,
        total_cents: total,
      })
      .select("id")
      .single();
    if (invErr || !invoice) {
      setBusy(false);
      setError(invErr?.message ?? "invoice insert failed");
      return;
    }
    const { error: linesErr } = await supabase.from("invoice_lines").insert(
      chosen.map((v, i) => ({
        invoice_id: invoice.id,
        visit_id: v.id,
        description: `Dog walk — ${v.dog_label ?? "visit"} — ${
          v.check_in_time ? new Date(v.check_in_time).toLocaleDateString() : ""
        }`,
        quantity: 1,
        unit_price_cents: lineCents[i],
        amount_cents: lineCents[i],
      })),
    );
    setBusy(false);
    if (linesErr) setError(`invoice created but lines failed: ${linesErr.message}`);
    else {
      setDraftClient("");
      load();
    }
  }

  async function setStatus(id: string, status: string) {
    const { error } = await supabase
      .from("invoices")
      .update({ status, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) setError(error.message);
    else setInvoices((rows) => rows.map((r) => (r.id === id ? { ...r, status } : r)));
  }

  const clientName = (id: string) => clients.find((c) => c.id === id)?.full_name ?? "?";

  return (
    <div className="card">
      <h3>Invoices</h3>
      {error && <p className="error">{error}</p>}

      <label>
        New invoice for
        <select value={draftClient} onChange={(e) => setDraftClient(e.target.value)}>
          <option value="">— pick a client —</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.full_name}
            </option>
          ))}
        </select>
      </label>

      {draftClient && (
        <div style={{ marginBottom: 12 }}>
          {billable.length === 0 && (
            <p className="muted">
              No un-invoiced completed visits for this client. (Only visits
              checked in with registered dogs carry a client — label-only
              walks can't be invoiced.)
            </p>
          )}
          {billable.map((v) => (
            <div key={v.id} style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 4 }}>
              <label style={{ flex: 1 }}>
                <input
                  type="checkbox"
                  checked={picked[v.id] ?? false}
                  onChange={(e) => setPicked({ ...picked, [v.id]: e.target.checked })}
                />{" "}
                {v.check_in_time ? new Date(v.check_in_time).toLocaleDateString() : "?"} ·{" "}
                {v.dog_label ?? "visit"} · {formatDuration(v.duration_minutes)}
              </label>
              {picked[v.id] && (
                <input
                  style={{ width: 90 }}
                  placeholder="$"
                  value={prices[v.id] ?? ""}
                  onChange={(e) => setPrices({ ...prices, [v.id]: e.target.value })}
                />
              )}
            </div>
          ))}
          {billable.length > 0 && (
            <button onClick={createInvoice} disabled={busy} style={{ marginTop: 8 }}>
              {busy ? "Creating…" : "Create draft invoice"}
            </button>
          )}
        </div>
      )}

      <h3>Recent</h3>
      {invoices.map((inv) => (
        <p key={inv.id}>
          <strong>{clientName(inv.client_id)}</strong> · {centsToDollars(inv.total_cents)} ·{" "}
          {inv.status}
          {inv.qb_invoice_id && " · QB ✓"}
          <span className="muted"> {inv.issue_date ?? ""}</span>{" "}
          {inv.status === "draft" && (
            <button className="secondary" onClick={() => setStatus(inv.id, "sent")}>
              mark sent
            </button>
          )}{" "}
          {inv.status === "sent" && (
            <button className="secondary" onClick={() => setStatus(inv.id, "paid")}>
              mark paid
            </button>
          )}
        </p>
      ))}
      {invoices.length === 0 && <p className="muted">No invoices yet.</p>}
    </div>
  );
}
