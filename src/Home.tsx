import { useCallback, useEffect, useState } from "react";
import { supabase } from "./supabase";
import { CheckIn } from "./CheckIn";
import { ActiveVisit } from "./ActiveVisit";
import { PastVisits } from "./PastVisits";
import { VisitDetail } from "./VisitDetail";

export interface Visit {
  id: string;
  dog_label: string | null;
  check_in_time: string | null;
  calendar_event_id: string | null;
}

export function Home({ walkerId }: { walkerId: string }) {
  const [visit, setVisit] = useState<Visit | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openVisitId, setOpenVisitId] = useState<string | null>(null);

  const loadActiveVisit = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error } = await supabase
      .from("visits")
      .select("id, dog_label, check_in_time, calendar_event_id")
      .eq("status", "active")
      .eq("walker_id", walkerId)
      .order("check_in_time", { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();
    if (error) setError(error.message);
    setVisit(data ?? null);
    setLoading(false);
  }, [walkerId]);

  useEffect(() => {
    loadActiveVisit();
  }, [loadActiveVisit]);

  if (loading) return <p className="muted">Loading…</p>;
  if (error) return <p className="error">{error}</p>;

  if (openVisitId) {
    return <VisitDetail visitId={openVisitId} onBack={() => setOpenVisitId(null)} />;
  }

  return (
    <>
      {visit ? (
        <ActiveVisit visit={visit} onCheckedOut={loadActiveVisit} />
      ) : (
        <CheckIn walkerId={walkerId} onCheckedIn={loadActiveVisit} />
      )}
      <PastVisits onOpen={setOpenVisitId} />
    </>
  );
}
