-- @contract: additive
-- The sla.breached event (and its email to the assignee or the assigned team)
-- now fires in every workspace, not only those with a live SLA workflow. Its
-- fire-once marker (*BreachTriggerFiredAt in sla_applied) was never set in
-- workspaces without such a workflow, so the first sweep after the upgrade
-- would email every open clock that breached in the last 24 hours at once:
-- breaches the team can already see in the inbox. Mark the clocks that are
-- already past due as fired, once, so only breaches from now on send email.
--
-- Only running clocks are marked, the ones the sweep would pick up: not
-- paused (a paused clock's deadline moves when it resumes, and it fires then
-- as usual) and not yet settled. A clock re-armed later starts with a clear
-- marker, as before.
--
-- The column comment written in the same block marks this database as done,
-- so a second run never marks a breach that happened after the first run.
-- @replay: guarded-by the conversations.sla_applied column comment; once it is written the block does nothing, so no later breach is ever marked
DO $$
DECLARE
  -- sla_applied stores ISO-8601 UTC strings, which compare in time order.
  now_iso text := to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
BEGIN
  IF col_description('conversations'::regclass, (
    SELECT attnum FROM pg_attribute
    WHERE attrelid = 'conversations'::regclass AND attname = 'sla_applied'
  )) IS DISTINCT FROM 'The applied SLA stamp. Breaches before migration 0324 were marked as already emailed.' THEN
    UPDATE "conversations"
    SET "sla_applied" = "sla_applied" || jsonb_build_object('firstResponseBreachTriggerFiredAt', now_iso)
    WHERE "sla_applied" IS NOT NULL
      AND ("sla_applied" ->> 'pausedAt') IS NULL
      AND ("sla_applied" ->> 'firstResponseDueAt') < now_iso
      AND ("sla_applied" ->> 'firstResponseAt') IS NULL
      AND ("sla_applied" ->> 'firstResponseBreachTriggerFiredAt') IS NULL;

    UPDATE "conversations"
    SET "sla_applied" = "sla_applied" || jsonb_build_object('nextResponseBreachTriggerFiredAt', now_iso)
    WHERE "sla_applied" IS NOT NULL
      AND ("sla_applied" ->> 'pausedAt') IS NULL
      AND ("sla_applied" ->> 'nextResponseDueAt') < now_iso
      AND ("sla_applied" ->> 'nextResponseAt') IS NULL
      AND ("sla_applied" ->> 'nextResponseBreachTriggerFiredAt') IS NULL;

    UPDATE "conversations"
    SET "sla_applied" = "sla_applied" || jsonb_build_object('resolutionBreachTriggerFiredAt', now_iso)
    WHERE "sla_applied" IS NOT NULL
      AND ("sla_applied" ->> 'pausedAt') IS NULL
      AND ("sla_applied" ->> 'timeToCloseDueAt') < now_iso
      AND ("sla_applied" ->> 'resolvedAt') IS NULL
      AND ("sla_applied" ->> 'resolutionBreachTriggerFiredAt') IS NULL;

    UPDATE "tickets"
    SET "sla_applied" = "sla_applied" || jsonb_build_object('resolutionBreachTriggerFiredAt', now_iso)
    WHERE "sla_applied" IS NOT NULL
      AND ("sla_applied" ->> 'pausedAt') IS NULL
      AND ("sla_applied" ->> 'timeToResolveDueAt') < now_iso
      AND ("sla_applied" ->> 'resolvedAt') IS NULL
      AND ("sla_applied" ->> 'resolutionBreachTriggerFiredAt') IS NULL;

    COMMENT ON COLUMN "conversations"."sla_applied" IS
      'The applied SLA stamp. Breaches before migration 0324 were marked as already emailed.';
  END IF;
END $$;
