-- Phase 2: weather conditions on the visit row (ROADMAP Phase 2 scope,
-- "Open-Meteo weather"). Captured at checkout from the walk's own GPS
-- coordinates; consumed by the report-card email and Phase 8 analytics.
-- NULLs mean the fetch failed or the visit predates this feature — weather
-- is enrichment, never a reason a checkout can fail.

ALTER TABLE public.visits
    ADD COLUMN weather_temp_c NUMERIC(4,1),      -- air temperature, °C
    ADD COLUMN weather_code SMALLINT,            -- WMO weather interpretation code (Open-Meteo `weather_code`)
    ADD COLUMN weather_wind_kmh NUMERIC(5,1),    -- wind speed at 10m, km/h
    ADD COLUMN weather_precip_mm NUMERIC(5,2);   -- precipitation in the current hour, mm

COMMENT ON COLUMN public.visits.weather_code IS
    'WMO code as returned by Open-Meteo; human label lives in app code (src/weather.ts), not the DB.';
