// Money is integer cents, never floats (ROADMAP decision log). Parsing goes
// through strings — parseFloat("24.10") * 100 is 2409.9999… territory, which
// is exactly the cents-level bug the routing table calls a trust-killer.

/** "24", "24.5", "$24.50", " 1,250.00 " → cents. null = not a valid amount. */
export function dollarsToCents(input: string): number | null {
  const cleaned = input.trim().replace(/^\$/, "").replaceAll(",", "");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const [whole, frac = ""] = cleaned.split(".");
  return Number(whole) * 100 + Number(frac.padEnd(2, "0") || "0");
}

/** 2450 → "$24.50". Negative allowed (refund lines someday). */
export function centsToDollars(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(Math.round(cents));
  return `${sign}$${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}
