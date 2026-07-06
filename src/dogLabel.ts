// Single source of truth lives in _shared so the report-card edge function
// uses the identical parse. Tests: src/dogLabel.test.ts.
export { splitDogLabel } from "../supabase/functions/_shared/dogLabel";
