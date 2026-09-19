/**
 * The lossless conversion of the three legacy guidance sources.
 *
 * Migration 0291 adds the tables and carries no backfill, because it has to
 * replay as a no-op and because the conversion is more than an UPDATE can
 * express: it has to preserve each legacy row's creation instant (the prompt
 * orders candidates by it), its exact per-role scope, and bodies up to 8,000
 * characters that no legacy column but the skill body could hold. So it runs
 * here, in code, once per workspace, idempotently, on first read.
 *
 * Idempotency is the database's, not this file's: `(legacy_source, legacy_id)`
 * is unique, every insert is `ON CONFLICT DO NOTHING`, and two processes
 * converting at the same moment therefore agree without a lock.
 *
 * The conversion is one way. A rule or skill written through the legacy path
 * after the cutover is picked up by the next pass, but an EDIT to a row that
 * already converted is not: the canonical entry is the authored record from
 * then on, and re-reading the legacy row would silently overwrite whatever was
 * authored here. The legacy rows stay for rollback, not as a second writer.
 */
import { inArray } from 'drizzle-orm'
import {
  db as defaultDb,
  agentSkills,
  assistantGuidanceRules,
  assistantGuidanceEntries,
  assistantGuidanceBindings,
} from '@/lib/server/db'
import type { Executor } from '@/lib/server/domains/principals/principal.factory'
import type { GuidanceEntryId } from '@quackback/ids'
import { logger } from '@/lib/server/logger'
import type { AssistantAgentKind, AssistantConfig } from '@/lib/shared/assistant/config'
import { GUIDANCE_PROFILES } from '@/lib/shared/assistant/guidance-entry'

const log = logger.child({ component: 'guidance-conversion' })

/**
 * The stable titles the two config-owned projections carry.
 *
 * They are the labels the compatibility list already showed, so the Guidance
 * page reads the same before and after the cutover.
 */
export const WRITING_GUIDELINES_TITLE = 'Everyday instructions'
export const MANAGED_INSTRUCTIONS_TITLE = 'Workspace and Slack instructions'

/** The config paths the two projections mirror, used as their legacy identity. */
export const WRITING_GUIDELINES_PATH = 'agents.agent.voice.additionalInstructions'
export const MANAGED_INSTRUCTIONS_PATH = 'agents.workspace.instructions'

type EntryInsert = typeof assistantGuidanceEntries.$inferInsert

async function insertBindings(
  pairs: Array<{ entryId: string; profile: AssistantAgentKind }>,
  execDb: Executor
): Promise<void> {
  if (pairs.length === 0) return
  await execDb
    .insert(assistantGuidanceBindings)
    .values(
      pairs.map(({ entryId, profile }) => ({
        entryId: entryId as GuidanceEntryId,
        profile,
        enabled: true,
      }))
    )
    .onConflictDoNothing()
}

async function convertedLegacyIds(
  execDb: Executor
): Promise<{ rules: Set<string>; skills: Set<string> }> {
  const rows = await execDb
    .select({
      legacySource: assistantGuidanceEntries.legacySource,
      legacyId: assistantGuidanceEntries.legacyId,
    })
    .from(assistantGuidanceEntries)
    .where(inArray(assistantGuidanceEntries.legacySource, ['rule', 'skill']))
  const rules = new Set<string>()
  const skills = new Set<string>()
  for (const row of rows) {
    if (!row.legacyId) continue
    if (row.legacySource === 'rule') rules.add(row.legacyId)
    else skills.add(row.legacyId)
  }
  return { rules, skills }
}

/**
 * Convert every legacy rule and skill that has no canonical entry yet.
 *
 * Cheap enough to sit on the read path: three small indexed reads decide
 * whether there is anything to do at all, and a converted workspace pays only
 * those. Failures are logged and swallowed in the same direction the runtime
 * already fails, because a conversion that cannot run must not take the turn
 * down with it; the entries it would have written are simply absent, and the
 * next read tries again.
 */
export async function ensureCanonicalGuidance(execDb: Executor = defaultDb): Promise<void> {
  try {
    const [ruleIds, skillIds, converted] = await Promise.all([
      execDb.select({ id: assistantGuidanceRules.id }).from(assistantGuidanceRules),
      execDb.select({ id: agentSkills.id }).from(agentSkills),
      convertedLegacyIds(execDb),
    ])

    const pendingRuleIds = ruleIds.map((row) => row.id).filter((id) => !converted.rules.has(id))
    const pendingSkillIds = skillIds.map((row) => row.id).filter((id) => !converted.skills.has(id))
    if (pendingRuleIds.length === 0 && pendingSkillIds.length === 0) return

    const values: EntryInsert[] = []
    const bindingsByLegacyId = new Map<string, AssistantAgentKind[]>()

    if (pendingRuleIds.length > 0) {
      const rules = await execDb
        .select()
        .from(assistantGuidanceRules)
        .where(inArray(assistantGuidanceRules.id, pendingRuleIds))
      for (const rule of rules) {
        values.push({
          kind: rule.appliesWhen === null ? 'always' : 'situational',
          owner: 'canonical',
          title: rule.name,
          body: rule.instruction,
          appliesWhen: rule.appliesWhen,
          enabled: rule.enabled,
          priority: rule.priority,
          legacySource: 'rule',
          legacyId: rule.id,
          createdById: rule.createdById,
          // The prompt orders candidates by creation instant, so the
          // conversion has to carry it or the same rules arrive in a
          // different order.
          createdAt: rule.createdAt,
          updatedAt: rule.updatedAt,
        })
        bindingsByLegacyId.set(`rule:${rule.id}`, [rule.agent as AssistantAgentKind])
      }
    }

    if (pendingSkillIds.length > 0) {
      const skills = await execDb
        .select()
        .from(agentSkills)
        .where(inArray(agentSkills.id, pendingSkillIds))
      for (const skill of skills) {
        values.push({
          kind: 'procedure',
          owner: 'canonical',
          title: skill.name,
          // The whole body, at whatever length it was written. A procedure is
          // the one legacy source that can carry 8,000 characters, and losing
          // any of them here is the failure this conversion exists to avoid.
          body: skill.instructions,
          appliesWhen: skill.whenToUse,
          enabled: skill.enabled,
          priority: 0,
          legacySource: 'skill',
          legacyId: skill.id,
          createdById: skill.createdByPrincipalId,
          createdAt: skill.createdAt,
          updatedAt: skill.updatedAt,
        })
        bindingsByLegacyId.set(
          `skill:${skill.id}`,
          GUIDANCE_PROFILES.filter((profile) => skill.assignments[profile] === true)
        )
      }
    }

    if (values.length === 0) return
    await execDb.insert(assistantGuidanceEntries).values(values).onConflictDoNothing()

    // Re-read rather than trusting the insert's returning set: a concurrent
    // pass may have written some of these rows, and their bindings still have
    // to be reconciled against the entry that actually exists.
    const written = await execDb
      .select({
        id: assistantGuidanceEntries.id,
        legacySource: assistantGuidanceEntries.legacySource,
        legacyId: assistantGuidanceEntries.legacyId,
      })
      .from(assistantGuidanceEntries)
      .where(inArray(assistantGuidanceEntries.legacySource, ['rule', 'skill']))

    const pairs: Array<{ entryId: string; profile: AssistantAgentKind }> = []
    for (const entry of written) {
      const profiles = bindingsByLegacyId.get(`${entry.legacySource}:${entry.legacyId}`)
      if (!profiles) continue
      for (const profile of profiles) pairs.push({ entryId: entry.id, profile })
    }
    await insertBindings(pairs, execDb)
    log.info(
      { rules: pendingRuleIds.length, procedures: pendingSkillIds.length },
      'converted legacy guidance into canonical entries'
    )
  } catch (err) {
    log.warn({ err }, 'legacy guidance conversion failed; canonical entries may be incomplete')
  }
}

interface ConfigProjection {
  path: string
  legacySource: 'voice' | 'managed'
  title: string
  body: string
  profile: AssistantAgentKind
}

/**
 * Project the two config-owned instruction blocks into the Guidance list.
 *
 * The assistant configuration stays their owner: it is versioned, it carries
 * the managed-field pins a deployment sets, and the prompt still renders both
 * blocks from it. The rows written here are what makes them appear in one list
 * with everything else, with their full text and their real scope, and they
 * are never read back into the prompt, so no instruction is injected twice.
 *
 * Called with the config in hand (the settings read path and the snapshot
 * builder both have it) so this never has to load or cache settings of its own.
 */
export async function projectConfigGuidance(
  config: AssistantConfig,
  execDb: Executor = defaultDb
): Promise<void> {
  const projections: ConfigProjection[] = [
    {
      path: WRITING_GUIDELINES_PATH,
      legacySource: 'voice',
      title: WRITING_GUIDELINES_TITLE,
      body: config.agents.agent.voice.additionalInstructions,
      profile: 'agent',
    },
    {
      path: MANAGED_INSTRUCTIONS_PATH,
      legacySource: 'managed',
      title: MANAGED_INSTRUCTIONS_TITLE,
      body: config.agents.workspace.instructions,
      profile: 'workspace',
    },
  ]

  try {
    const existing = await execDb
      .select()
      .from(assistantGuidanceEntries)
      .where(inArray(assistantGuidanceEntries.legacySource, ['voice', 'managed']))

    for (const projection of projections) {
      const current = existing.find(
        (row) => row.legacySource === projection.legacySource && row.legacyId === projection.path
      )
      if (!current) {
        await execDb
          .insert(assistantGuidanceEntries)
          .values({
            kind: 'always',
            owner: 'config',
            title: projection.title,
            body: projection.body,
            appliesWhen: null,
            enabled: true,
            priority: 0,
            legacySource: projection.legacySource,
            legacyId: projection.path,
          })
          .onConflictDoNothing()
        const [written] = await execDb
          .select({ id: assistantGuidanceEntries.id })
          .from(assistantGuidanceEntries)
          .where(inArray(assistantGuidanceEntries.legacySource, [projection.legacySource]))
          .limit(1)
        if (written) {
          await insertBindings([{ entryId: written.id, profile: projection.profile }], execDb)
        }
        continue
      }
      // The config moved under the projection: refresh the text, and only the
      // text. Version stays where it is, because the config's own revision is
      // what a concurrent edit is checked against.
      if (current.body !== projection.body) {
        await execDb
          .update(assistantGuidanceEntries)
          .set({ body: projection.body, updatedAt: new Date() })
          .where(inArray(assistantGuidanceEntries.id, [current.id]))
      }
      await insertBindings([{ entryId: current.id, profile: projection.profile }], execDb)
    }
  } catch (err) {
    log.warn({ err }, 'config guidance projection failed')
  }
}
