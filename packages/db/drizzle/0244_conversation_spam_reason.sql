-- Which rule or classifier filed a spam-ended conversation:
-- 'auto_responder' | 'sender_auth_failure' | 'burst_rate' (deterministic
-- signals), 'ai_classifier' (the AI fallback), or 'manual' (an agent).
-- Null for non-spam conversations; cleared by restore-from-spam.
ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "spam_reason" text;
