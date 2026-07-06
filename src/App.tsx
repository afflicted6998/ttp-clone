import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import { Login } from "./Login";
import { Home } from "./Home";
import { AdminHome } from "./admin/AdminHome";
import { isAdmin, useRole } from "./useRole";

export function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  if (!ready) return <p className="muted">Loading…</p>;
  if (!session) return <Login />;
  return <Shell session={session} />;
}

function Shell({ session }: { session: Session }) {
  const { role } = useRole(session.user.id);
  const [view, setView] = useState<"walks" | "admin">("walks");

  return (
    <div>
      <h1>Outside Feet — Visits</h1>
      <p className="muted">
        {session.user.email}{" "}
        {isAdmin(role) && view === "walks" && (
          <>
            ·{" "}
            <a href="#" onClick={(e) => { e.preventDefault(); setView("admin"); }}>
              admin
            </a>{" "}
          </>
        )}
        ·{" "}
        <a href="#" onClick={(e) => { e.preventDefault(); supabase.auth.signOut(); }}>
          sign out
        </a>
      </p>
      {view === "admin" && isAdmin(role) ? (
        <AdminHome onBack={() => setView("walks")} />
      ) : (
        <Home walkerId={session.user.id} />
      )}
    </div>
  );
}
