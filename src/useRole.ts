import { useEffect, useState } from "react";
import { supabase } from "./supabase";

export type StaffRole = "walker" | "admin" | "owner";

// The caller's staff role, from their own staff row. Filtered by
// auth_user_id explicitly: admins can read EVERY staff row under RLS, so a
// bare maybeSingle() would start erroring the day a second walker is hired.
// null role = not staff (a client login, Phase 6) or row inactive.
export function useRole(userId: string): { role: StaffRole | null; ready: boolean } {
  const [role, setRole] = useState<StaffRole | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    supabase
      .from("staff")
      .select("role")
      .eq("auth_user_id", userId)
      .eq("active", true)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled) {
          setRole((data?.role as StaffRole | undefined) ?? null);
          setReady(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  return { role, ready };
}

export function isAdmin(role: StaffRole | null): boolean {
  return role === "admin" || role === "owner";
}
