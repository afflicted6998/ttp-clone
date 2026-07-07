import { useCallback, useEffect, useState } from "react";
import { supabase } from "../supabase";
import { formatDistance, formatDuration } from "../format";
import { centsToDollars } from "../money";
import { chargeBooking } from "../stripeClient";

interface StaffOption {
  id: string;
  full_name: string;
  active: boolean;
}

interface VisitRow {
  id: string;
  dog_label: string | null;
  status: string;
  check_in_time: string | null;
  scheduled_start: string | null;
  duration_minutes: number | null;
  distance_meters: number | null;
  assigned_staff_id: string | null;
  report_sent_at: string | null;
  client_id: string | null;
  price_cents: number | null;
  payment_status: string;
}

const PAYMENT_LABEL: Record<string, string> = {
  not_required: "",
  unpaid: "unpaid",
  paid: "paid ✓",
  override: "unpaid (override)",
  refunded: "refunded",
};

// Visit oversight + assignment (ROADMAP Phase 3: "visit assignment · visit
// oversight"). Admin-only via RLS "visits admin all"; assignment writes
// assigned_staff_id (who is SUPPOSED to do it — walker_id stays "who did").
// With a staff of one this assigns everything to Steve, but it exercises the
// exact flow hiring will need, which is the point of building it now.
export function VisitsAdmin() {
  const [visits, setVisits] = useState<VisitRow[]>([]);
  const [staff, setStaff] = useState<StaffOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [payBusyId, setPayBusyId] = useState<string | null>(null);
  const [overriding, setOverriding] = useState<string | null>(null);
  const [overrideReason, setOverrideReason] = useState("");
  const [myStaffId, setMyStaffId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const twoWeeksAgo = new Date(Date.now() - 14 * 86400_000).toISOString();
    const [visitsRes, staffRes] = await Promise.all([
      supabase
        .from("visits")
        .select(
          "id, dog_label, status, check_in_time, scheduled_start, duration_minutes, distance_meters, assigned_staff_id, report_sent_at, client_id, price_cents, payment_status",
        )
        .or(`check_in_time.gte.${twoWeeksAgo},scheduled_start.gte.${twoWeeksAgo}`)
        .order("check_in_time", { ascending: false, nullsFirst: true })
        .limit(50),
      supabase.from("staff").select("id, full_name, active").order("full_name"),
    ]);
    if (visitsRes.error) setError(visitsRes.error.message);
    else setVisits(visitsRes.data ?? []);
    if (staffRes.data) setStaff(staffRes.data);
  }, []);

  useEffect(() => {
    load();
    // Who am I, for the override audit trail (payment_override_by).
    supabase.rpc("app_staff_id").then(({ data }) => setMyStaffId((data as string | null) ?? null));
  }, [load]);

  // Charge the client's saved card for this visit (off-session, via the Stripe
  // edge function). A decline comes back as an error string with the reason.
  async function charge(visitId: string) {
    setPayBusyId(visitId);
    setError(null);
    const { data, error } = await chargeBooking(visitId);
    setPayBusyId(null);
    if (error) {
      setError(`charge failed: ${error}`);
      load(); // the failed attempt is recorded; refresh status
      return;
    }
    if (data && !data.paid && !data.already_paid) {
      setError(`charge is ${data.status ?? "processing"} — not yet confirmed paid`);
    }
    load();
  }

  // Admin override: let an unpaid walk proceed, recording who/when/why. The
  // visit stays visibly flagged (payment_status 'override').
  async function saveOverride(visitId: string) {
    if (!overrideReason.trim()) {
      setError("Give a reason for the override");
      return;
    }
    setPayBusyId(visitId);
    setError(null);
    const { error } = await supabase
      .from("visits")
      .update({
        payment_status: "override",
        payment_override_by: myStaffId,
        payment_override_at: new Date().toISOString(),
        payment_override_reason: overrideReason.trim(),
      })
      .eq("id", visitId);
    setPayBusyId(null);
    if (error) setError(error.message);
    else {
      setOverriding(null);
      setOverrideReason("");
      load();
    }
  }

  async function assign(visitId: string, staffId: string) {
    setSavingId(visitId);
    setError(null);
    const { error } = await supabase
      .from("visits")
      .update({ assigned_staff_id: staffId || null, updated_at: new Date().toISOString() })
      .eq("id", visitId);
    setSavingId(null);
    if (error) setError(error.message);
    else {
      setVisits((vs) =>
        vs.map((v) => (v.id === visitId ? { ...v, assigned_staff_id: staffId || null } : v)),
      );
    }
  }

  const when = (v: VisitRow) => {
    const t = v.check_in_time ?? v.scheduled_start;
    return t ? new Date(t).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—";
  };

  return (
    <div className="card">
      <h3>Visits — last 14 days & upcoming ({visits.length})</h3>
      {error && <p className="error">{error}</p>}
      {visits.map((v) => (
        <div key={v.id} style={{ borderTop: "1px solid #eee", padding: "8px 0" }}>
          <p style={{ margin: 0 }}>
            <strong>{v.dog_label ?? "(no dog label)"}</strong>{" "}
            <span className="muted">
              · {when(v)} · {v.status}
              {v.status === "completed" &&
                ` · ${formatDuration(v.duration_minutes)} · ${formatDistance(v.distance_meters)}`}
              {v.report_sent_at && " · report ✓"}
            </span>
          </p>
          <label style={{ display: "block", marginTop: 4 }}>
            Assigned to{" "}
            <select
              value={v.assigned_staff_id ?? ""}
              disabled={savingId === v.id}
              onChange={(ev) => assign(v.id, ev.target.value)}
            >
              <option value="">— unassigned —</option>
              {staff
                .filter((s) => s.active || s.id === v.assigned_staff_id)
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.full_name}
                  </option>
                ))}
            </select>
          </label>

          {/* Payment (issue #40 gate). Only booked visits (a client + a status
              past 'not_required') show billing controls — ad-hoc/test walks
              stay out of the gate. */}
          {v.client_id && v.payment_status !== "not_required" && (
            <div style={{ marginTop: 4 }}>
              <span className="muted">
                Payment: {PAYMENT_LABEL[v.payment_status] ?? v.payment_status}
                {v.price_cents != null && ` · ${centsToDollars(v.price_cents)}`}
              </span>{" "}
              {(v.payment_status === "unpaid" || v.payment_status === "override") && (
                <button
                  className="secondary"
                  disabled={payBusyId === v.id}
                  onClick={() => charge(v.id)}
                >
                  {payBusyId === v.id ? "Charging…" : "Charge card"}
                </button>
              )}{" "}
              {v.payment_status === "unpaid" && overriding !== v.id && (
                <button className="secondary" onClick={() => setOverriding(v.id)}>
                  Override
                </button>
              )}
              {overriding === v.id && (
                <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                  <input
                    style={{ flex: 1 }}
                    placeholder="Reason (e.g. card issue, will retry)"
                    value={overrideReason}
                    onChange={(ev) => setOverrideReason(ev.target.value)}
                  />
                  <button disabled={payBusyId === v.id} onClick={() => saveOverride(v.id)}>
                    Confirm override
                  </button>
                  <button
                    className="secondary"
                    onClick={() => {
                      setOverriding(null);
                      setOverrideReason("");
                    }}
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      ))}
      {visits.length === 0 && <p className="muted">No visits in the window.</p>}
    </div>
  );
}
