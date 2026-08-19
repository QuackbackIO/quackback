import { describe, it, expect, afterAll } from 'vitest'
import { sql } from 'drizzle-orm'
import { createDb, type Database } from '../client'

// 0204 reshapes assistant_config v2 -> v3, rewrites the voice managed-field
// paths, and — the part guarded here — splits each guidance rule's roles[] onto
// a single owning `agent` column (D4), copying a dual-role rule into an
// independent Copilot row.
//
// Isolation mirrors migration-0201: one transaction, assert, then roll back so
// dev/test data is untouched. The twist: 0204 is irreversible on the live DB
// (it DROPs assistant_guidance_rules.roles), so the pre-migration shape can no
// longer be reconstructed in the real tables. We therefore rebuild the
// pre-migration shapes in scratch tables inside the rolled-back transaction and
// run 0204's exact split/reshape statements against them — the statement text
// here must stay in lockstep with 0204_assistant_config_v3.sql.
const DB_URL = process.env.DATABASE_URL
let db: Database | null = null
const dbAvailable = !!DB_URL
if (DB_URL) db = createDb(DB_URL, { max: 1 })

afterAll(async () => {
  // @ts-expect-error optional teardown
  await db?.$client?.end?.()
})

const COPILOT_SUFFIX = ' (Copilot)'

describe.skipIf(!dbAvailable)('migration 0204 config v3', () => {
  it('splits guidance roles[] onto a single owning agent, copying dual-role rules', async () => {
    if (!db) return
    await db
      .transaction(async (tx) => {
        // Pre-migration guidance shape: roles[] present, agent absent.
        await tx.execute(sql`
          CREATE TABLE _m0204_rules (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            name text NOT NULL,
            applies_when text,
            instruction text NOT NULL,
            -- Mirror the pre-0204 column exactly (0196): NOT NULL with a default,
            -- which is why 0204's step-4a copy INSERT can omit roles.
            roles text[] NOT NULL DEFAULT ARRAY['customer_support', 'suggested_reply']::text[],
            agent text,
            enabled boolean NOT NULL DEFAULT true,
            priority integer NOT NULL DEFAULT 0,
            created_by_id uuid,
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now()
          )
        `)

        const eightyCharName = 'X'.repeat(80)
        await tx.execute(sql`
          INSERT INTO _m0204_rules (name, applies_when, instruction, roles) VALUES
            ('Single agent', NULL, 'Do the agent thing', ARRAY['customer_support']),
            ('Suggested only', NULL, 'Draft a reply', ARRAY['suggested_reply']),
            ('Copilot only', NULL, 'Answer the teammate', ARRAY['copilot_qa']),
            ('Dual role', 'When refunds', 'Explain policy', ARRAY['customer_support','copilot_qa']),
            (${eightyCharName}, NULL, 'Edge instruction', ARRAY['customer_support','copilot_qa'])
        `)

        // 0204 step 4a: copy every dual-role rule into an independent Copilot row.
        // Base is truncated BEFORE the suffix so the suffix is never clipped and
        // two distinct 80-char names can't collapse to identical copies (F1).
        await tx.execute(sql`
          INSERT INTO _m0204_rules
            (id, name, applies_when, instruction, agent, enabled, priority, created_by_id, created_at, updated_at)
          SELECT
            gen_random_uuid(),
            left(name, 80 - length(' (Copilot)')) || ' (Copilot)',
            applies_when,
            instruction,
            'copilot',
            enabled,
            priority,
            created_by_id,
            created_at,
            updated_at
          FROM _m0204_rules AS src
          WHERE 'copilot_qa' = ANY(roles)
            AND ('customer_support' = ANY(roles) OR 'suggested_reply' = ANY(roles))
            AND NOT EXISTS (
              SELECT 1 FROM _m0204_rules AS copy
              WHERE copy.agent = 'copilot'
                AND copy.name = left(src.name, 80 - length(' (Copilot)')) || ' (Copilot)'
                AND copy.applies_when = src.applies_when
                AND copy.instruction = src.instruction
            )
        `)

        // 0204 step 4b: resolve the agent for every original row.
        await tx.execute(sql`
          UPDATE _m0204_rules
          SET agent = CASE
            WHEN 'customer_support' = ANY(roles) OR 'suggested_reply' = ANY(roles) THEN 'agent'
            ELSE 'copilot'
          END
          WHERE agent IS NULL
        `)

        const rows = (await tx.execute<{ name: string; agent: string; roles: string[] }>(sql`
          SELECT name, agent, roles FROM _m0204_rules ORDER BY name
        `)) as unknown as { name: string; agent: string; roles: string[] }[]

        const byName = new Map(rows.map((r) => [r.name, r]))

        // Single customer-facing role -> agent, no copy.
        expect(byName.get('Single agent')?.agent).toBe('agent')
        expect(byName.get('Suggested only')?.agent).toBe('agent')
        // copilot_qa-only -> copilot, no copy.
        expect(byName.get('Copilot only')?.agent).toBe('copilot')
        expect(rows.filter((r) => r.name.startsWith('Copilot only'))).toHaveLength(1)

        // Dual role -> the original becomes the Agent rule and an independent
        // Copilot copy is created.
        expect(byName.get('Dual role')?.agent).toBe('agent')
        expect(byName.get(`Dual role${COPILOT_SUFFIX}`)?.agent).toBe('copilot')

        // 80-char name edge (F1): the copy keeps its full suffix and is distinct
        // from the original — no truncated-suffix collision.
        const eightyOriginal = byName.get('X'.repeat(80))
        expect(eightyOriginal?.agent).toBe('agent')
        const eightyCopyName = 'X'.repeat(70) + COPILOT_SUFFIX
        const eightyCopy = byName.get(eightyCopyName)
        expect(eightyCopy?.agent).toBe('copilot')
        expect(eightyCopyName).toHaveLength(80)
        expect(eightyCopyName.endsWith(COPILOT_SUFFIX)).toBe(true)
        expect(eightyCopyName).not.toBe('X'.repeat(80))

        // Exactly the two dual-role rules produced Copilot copies (2 originals +
        // 2 copies + 3 single-agent/copilot-only originals = 7 rows total).
        expect(rows).toHaveLength(7)
        expect(rows.filter((r) => r.agent === 'copilot')).toHaveLength(3)

        throw new Error('__ROLLBACK__')
      })
      .catch((e) => {
        if (!(e instanceof Error) || e.message !== '__ROLLBACK__') throw e
      })
  })

  it('reshapes a v2 config to v3 and rewrites the voice managed-field paths', async () => {
    if (!db) return
    await db
      .transaction(async (tx) => {
        await tx.execute(sql`
          CREATE TABLE _m0204_settings (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            assistant_config jsonb,
            managed_field_paths jsonb
          )
        `)

        // A v2-shaped settings row: flat voice, identity, no agents object.
        await tx.execute(sql`
          INSERT INTO _m0204_settings (assistant_config, managed_field_paths) VALUES (
            '{"version":2,"identity":{"name":"Quinn","avatarUrl":null},"voice":{"tone":"warm","responseLength":"detailed","additionalInstructions":"Be kind"}}'::jsonb,
            '["assistant.voice","assistant.voice.tone","assistant.identity.name"]'::jsonb
          )
        `)

        // 0204 step 1: reshape v2 -> v3.
        await tx.execute(sql`
          UPDATE _m0204_settings
          SET assistant_config = jsonb_build_object(
            'version', 3,
            'identity', assistant_config->'identity',
            'agents', jsonb_build_object(
              'agent', jsonb_build_object(
                'voice', assistant_config->'voice',
                'knowledge', jsonb_build_object(
                  'helpCenter', true, 'posts', false, 'changelog', false, 'status', false
                )
              ),
              'copilot', jsonb_build_object(
                'capabilities', jsonb_build_object('qa', true, 'suggestedReplies', true),
                'knowledge', jsonb_build_object(
                  'helpCenter', true, 'posts', true, 'pastConversations', true,
                  'internalNotes', true, 'tickets', false, 'changelog', false, 'status', true
                )
              )
            )
          )
          WHERE assistant_config->>'version' = '2'
        `)

        // 0204 step 3: rewrite the voice managed-field paths.
        await tx.execute(sql`
          UPDATE _m0204_settings
          SET managed_field_paths = COALESCE(
            (
              SELECT jsonb_agg(
                CASE
                  WHEN elem = 'assistant.voice' THEN 'assistant.agents.agent.voice'
                  WHEN elem LIKE 'assistant.voice.%'
                    THEN 'assistant.agents.agent.' || substring(elem FROM length('assistant.') + 1)
                  ELSE elem
                END
              )
              FROM jsonb_array_elements_text(managed_field_paths) AS elem
            ),
            '[]'::jsonb
          )
          WHERE EXISTS (
            SELECT 1 FROM jsonb_array_elements_text(managed_field_paths) AS e
            WHERE e = 'assistant.voice' OR e LIKE 'assistant.voice.%'
          )
        `)

        const rows = (await tx.execute<{ config: unknown; paths: unknown }>(sql`
          SELECT assistant_config AS config, managed_field_paths AS paths FROM _m0204_settings
        `)) as unknown as {
          config: {
            version: number
            identity: { name: string }
            agents: {
              agent: { voice: { tone: string; additionalInstructions: string }; knowledge: unknown }
              copilot: { capabilities: unknown; knowledge: unknown }
            }
          }
          paths: string[]
        }[]

        const { config, paths } = rows[0]
        expect(config.version).toBe(3)
        // Voice carried over verbatim under agents.agent.
        expect(config.agents.agent.voice.tone).toBe('warm')
        expect(config.agents.agent.voice.additionalInstructions).toBe('Be kind')
        // Copilot initialized to defaults; identity carried over.
        expect(config.identity.name).toBe('Quinn')
        expect(config.agents.copilot.capabilities).toEqual({ qa: true, suggestedReplies: true })

        // Voice paths rewritten; unrelated managed paths untouched.
        expect(paths).toContain('assistant.agents.agent.voice')
        expect(paths).toContain('assistant.agents.agent.voice.tone')
        expect(paths).toContain('assistant.identity.name')
        expect(paths).not.toContain('assistant.voice')
        expect(paths).not.toContain('assistant.voice.tone')

        throw new Error('__ROLLBACK__')
      })
      .catch((e) => {
        if (!(e instanceof Error) || e.message !== '__ROLLBACK__') throw e
      })
  })
})
