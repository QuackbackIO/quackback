-- Add setup_state column for tracking onboarding/provisioning state
ALTER TABLE "settings" ADD COLUMN "setup_state" text;
