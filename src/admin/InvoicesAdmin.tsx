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

interface PaymentRow {
  id: string;
  client_id: string;
  amount_cents: number;
  status: string;
  created_at: string;
  error_message: string | null;
}

// Billing admin. Two things live here now:
//   1. The CARD-CHARGE LEDGER — the read-only record of Stripe charges (issue
//      #40's pre-payment gate). This is the primary billing rail: bookings
//      auto-charge the saved card; those attempts land in `payments` and are
//      listed below.
//   2. MANUAL / CORNER-CASE INVOICES — the original Phase 4 tool, repurposed
//      for the cases the auto-charge gate doesn't cover (off-Stripe payment,
//      an adjustment, a one-off bill). Prices are typed per line here on
//      purpose; the catalog price drives the automatic path, not this one.
// QuickBooks sync is dropped for the payment flow (issue #40 ruling): Stripe's
// own reporting is the revenue record until the future books-agent project.
export function InvoicesAdmin() {
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  // "new invoice" flow state
  const [draftClient, setDraftClient] = useState<string>("");
  const [billable, setBillable] = useState<BillableVisit[]>([]);
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [prices, setPrices] = useState<Record<string, string>>({}); // visit id → dollars text
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [clientsRes, invoicesRes, paymentsRes] = await Promise.all([
      supabase.from("clients").select("id, full_name").eq("active", true).order("full_name"),
      supabase
        .from("invoices")
        .select("id, client_id, status, issue_date, total_cents, qb_invoice_id")
        .order("created_at", { ascending: false })
        .limit(30),
      supabase
        .from("payments")
        .select("id, client_id, amount_cents, status, created_at, error_message")
        .order("created_at", { ascending: false })
        .limit(30),
    ]);
    if (clientsRes.data) setClients(clientsRes.data);
    if (invoicesRes.error) setError(invoicesRes.error.message);
    else setInvoices(invoicesRes.data ?? []);
    if (paymentsRes.data) setPayments(paymentsRes.data);
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
      <h3>Billing</h3>
      {error && <p className="error">{error}</p>}

      <h4>Card charges</h4>
      {payments.length === 0 && (
        <p className="muted">
          No card charges yet. Bookings auto-charge the client's saved card once
          Stripe is live; attempts show here.
        </p>
      )}
      {payments.map((p) => (
        <p key={p.id} style={{ margin: "2px 0" }}>
          <strong>{clientName(p.client_id)}</strong> · {centsToDollars(p.amount_cents)} ·{" "}
          <span className={p.status === "failed" ? "error" : undefined}>{p.status}</span>
          <span className="muted"> {new Date(p.created_at).toLocaleDateString()}</span>
          {p.error_message && <span className="muted"> · {p.error_message}</span>}
        </p>
      ))}

      <h4 style={{ marginTop: 16 }}>Manual / corner-case invoice</h4>
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
