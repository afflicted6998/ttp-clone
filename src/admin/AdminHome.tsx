import { useState } from "react";
import { ClientsAdmin } from "./ClientsAdmin";
import { DogsAdmin } from "./DogsAdmin";
import { VisitsAdmin } from "./VisitsAdmin";
import { RollupsAdmin } from "./RollupsAdmin";
import { InvoicesAdmin } from "./InvoicesAdmin";
import { SchedulesAdmin } from "./SchedulesAdmin";
import type { StaffRole } from "../useRole";

type Tab = "clients" | "dogs" | "visits" | "schedules" | "invoices" | "rollups";

// Phase 3: the admin area, gated upstream by useRole/isAdmin. Rollups is
// owner-only (ruling 1: Owner = Admin + business rollups). Tabs instead of
// routes — the PWA has no router yet, and adding one is a UI/UX decision
// deferred with the brand pass (ROADMAP pending-decisions).
export function AdminHome({ role, onBack }: { role: StaffRole | null; onBack: () => void }) {
  const [tab, setTab] = useState<Tab>("visits");

  const tabs: { id: Tab; label: string }[] = [
    { id: "visits", label: "Visits" },
    { id: "clients", label: "Clients" },
    { id: "dogs", label: "Dogs" },
    { id: "schedules", label: "Schedules" },
    { id: "invoices", label: "Invoices" },
    ...(role === "owner" ? [{ id: "rollups" as Tab, label: "Rollups" }] : []),
  ];

  return (
    <div>
      <button className="secondary" onClick={onBack}>
        ← Back to walks
      </button>
      <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
        {tabs.map((t) => (
          <button key={t.id} className={tab === t.id ? "" : "secondary"} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === "clients" && <ClientsAdmin />}
      {tab === "dogs" && <DogsAdmin />}
      {tab === "visits" && <VisitsAdmin />}
      {tab === "schedules" && <SchedulesAdmin />}
      {tab === "invoices" && <InvoicesAdmin />}
      {tab === "rollups" && role === "owner" && <RollupsAdmin />}
    </div>
  );
}
