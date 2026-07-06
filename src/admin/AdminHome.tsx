import { useState } from "react";
import { ClientsAdmin } from "./ClientsAdmin";
import { DogsAdmin } from "./DogsAdmin";

// Phase 3 scaffold: the admin area, gated upstream by useRole/isAdmin.
// Tabs instead of routes — the PWA has no router yet, and adding one is a
// UI/UX decision deferred with the brand pass (ROADMAP pending-decisions).
export function AdminHome({ onBack }: { onBack: () => void }) {
  const [tab, setTab] = useState<"clients" | "dogs">("clients");

  return (
    <div>
      <button className="secondary" onClick={onBack}>
        ← Back to walks
      </button>
      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <button className={tab === "clients" ? "" : "secondary"} onClick={() => setTab("clients")}>
          Clients
        </button>
        <button className={tab === "dogs" ? "" : "secondary"} onClick={() => setTab("dogs")}>
          Dogs
        </button>
      </div>
      {tab === "clients" ? <ClientsAdmin /> : <DogsAdmin />}
    </div>
  );
}
