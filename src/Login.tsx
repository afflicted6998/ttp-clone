import { useState } from "react";
import { supabase } from "./supabase";

export function Login() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function sendLink() {
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin },
    });
    setBusy(false);
    if (error) setError(error.message);
    else setSent(true);
  }

  return (
    <div className="card">
      <h1>Sign in</h1>
      {sent ? (
        <p>
          Magic link sent to <strong>{email}</strong>. Open it on this device —
          the link signs you in here.
        </p>
      ) : (
        <>
          <label>
            Email
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              inputMode="email"
            />
          </label>
          <button onClick={sendLink} disabled={busy || !email.includes("@")}>
            {busy ? "Sending…" : "Send magic link"}
          </button>
          {error && <p className="error">{error}</p>}
        </>
      )}
    </div>
  );
}
