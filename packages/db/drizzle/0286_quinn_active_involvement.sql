-- Never fabricate a resolution/handoff to make historical duplicates fit.
-- Operators must inspect transcript/history and explicitly review a repair.
DO $$
DECLARE duplicate_conversations text;
BEGIN
  SELECT string_agg(conversation_id::text, ', ') INTO duplicate_conversations
  FROM (
    SELECT conversation_id FROM assistant_involvements
    WHERE status = 'active'
    GROUP BY conversation_id HAVING count(*) > 1
    ORDER BY conversation_id LIMIT 20
  ) duplicates;
  IF duplicate_conversations IS NOT NULL THEN
    RAISE EXCEPTION 'Quinn active involvement duplicates require reviewed repair. Conversation UUIDs (first 20): %', duplicate_conversations;
  END IF;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS assistant_involvements_one_active_idx
ON assistant_involvements (conversation_id) WHERE status = 'active';
