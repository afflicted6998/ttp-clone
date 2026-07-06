// Parse the free-text dog_label into individual dog names — the bridge until
// check-in creates real visit_dogs rows (Phase 3). "Samson and Reba" is the
// norm, not the exception (decision log).

export function splitDogLabel(label: string | null): string[] {
  const dogs = (label ?? "")
    .split(/\s+and\s+|\s*[&+,]\s*/i)
    .map((s) => s.trim())
    .filter(Boolean);
  return dogs.length > 0 ? dogs : ["Unknown Dog"];
}
