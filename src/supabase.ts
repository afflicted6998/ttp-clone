import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

if (!url || !anonKey) {
  throw new Error(
    "Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY. Copy .env.example to .env (local) or set them in Vercel project settings (deploy).",
  );
}

// Anon key only — RLS is the security boundary. The service_role key must
// never appear in this app.
export const supabase = createClient(url, anonKey);
