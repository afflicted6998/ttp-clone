import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import { Login } from "./Login";
import { Home } from "./Home";

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

  return (
    <div>
      <h1>Outside Feet — Visits</h1>
      <p className="muted">
        {session.user.email}{" "}
        <a href="#" onClick={(e) => { e.preventDefault(); supabase.auth.signOut(); }}>
          sign out
        </a>
      </p>
      <Home walkerId={session.user.id} />
    </div>
  );
}
