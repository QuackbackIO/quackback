-- Retention scan support for the daily spam-retention sweep
-- (conversation.spam-retention.ts's sweepFiledSpamConversations).
--
-- The sweep's candidate set is "a conversation the MACHINE filed to Spam,
-- filed longer ago than the retention window". A spam-filed thread is a
-- permanent minority of the table and its predicate never stops being true
-- once set (restore-from-spam clears end_reason, which removes the row from
-- this index rather than leaving a stale entry), so a partial index on exactly
-- that predicate stays small for the life of a workspace instead of degrading
-- as one ages.
--
-- Ordered on resolved_at because that is the sweep's only range clause: the
-- filing instant is the clock the retention promise is made against, not
-- created_at (a property of the message) and not last_message_at (which a
-- reply could move). The 'manual' exclusion is left OUT of the predicate on
-- purpose — it is a cheap equality on rows already narrowed to spam, and
-- baking it in would make this index unusable for any other question about
-- filed spam, of which the Spam view itself is one.
--
-- Follows the conversations_snoozed_until_idx shape (migration 0139): the same
-- "sweeper wake pass over a partial candidate set" problem, solved the same way.
CREATE INDEX IF NOT EXISTS "conversations_spam_resolved_at_idx"
  ON "conversations" USING btree ("resolved_at")
  WHERE status = 'closed' AND end_reason = 'spam';
