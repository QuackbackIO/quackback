-- Add lastSentAt column to track when invitation email was last sent (for resend cooldown)
ALTER TABLE invitation ADD COLUMN last_sent_at timestamp with time zone;

-- Set lastSentAt to createdAt for existing invitations
UPDATE invitation SET last_sent_at = created_at WHERE last_sent_at IS NULL;
