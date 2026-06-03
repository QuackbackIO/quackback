-- ISO-3166-1 alpha-2 country code captured from CDN-injected headers
-- (CF-IPCountry, X-Vercel-IP-Country, Fly-Client-IP-Country, X-Country-Code)
-- on session creation. Stays NULL when no header is present — typical for
-- local development or deployments without a geo-aware reverse proxy.
-- Used as a built-in segment attribute so admins can target audiences
-- by region without a custom-attribute import.
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "country" text;
