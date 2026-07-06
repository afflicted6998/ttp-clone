// Shared form helpers for the admin CRM screens (Phase 3).

/** Empty/whitespace form inputs become NULL in the database, never "". */
export function blankToNull(s: string): string | null {
  const t = s.trim();
  return t === "" ? null : t;
}

/** DB nulls render as empty inputs. */
export function nullToBlank(s: string | null | undefined): string {
  return s ?? "";
}
