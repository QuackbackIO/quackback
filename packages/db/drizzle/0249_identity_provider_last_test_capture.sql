-- Persist the last successful Test sign-in fixture on the provider row so
-- the outcome preview survives a new settings session. The payload is the
-- merged claims and resolved identity the admin already saw in the test
-- result — no extra redaction. Null until a test succeeds.
ALTER TABLE "identity_provider" ADD COLUMN IF NOT EXISTS "last_test_capture" jsonb;
