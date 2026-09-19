/**
 * Canonical guidance entries and their role bindings.
 *
 * One entry holds the authored instruction; one binding per profile says who
 * applies it. Both are written in a single transaction, so a save that fails
 * leaves neither an entry without its bindings nor bindings without their
 * entry: a shared instruction that exists for one role and not the other is
 * exactly the fake shared write the compatibility stage refused to offer.
 *
 * Reads come in two shapes. The editor wants every entry with its uses
 * resolved; the runtime wants the bounded candidate list for one profile, and
 * asks for procedures separately because their bodies are loaded on demand and
 * never ride the prompt.
 */
import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import {
  db as defaultDb,
  assistantGuidanceEntries,
  assistantGuidanceBindings,
} from '@/lib/server/db'
import type { Executor } from '@/lib/server/domains/principals/principal.factory'
import type { GuidanceEntryId, PrincipalId } from '@quackback/ids'
import { ConflictError, NotFoundError, ValidationError } from '@/lib/shared/errors'
import type { AssistantAgentKind } from '@/lib/shared/assistant/config'
import {
  guidanceEntryInputSchema,
  GUIDANCE_PROFILES,
  GUIDANCE_RUNTIME_BUDGETS,
  type GuidanceEntryDTO,
  type GuidanceEntryInput,
  type GuidanceLegacySource,
  type NormalizedGuidanceEntryInput,
} from '@/lib/shared/assistant/guidance-entry'

export type GuidanceEntryRow = typeof assistantGuidanceEntries.$inferSelect
export type GuidanceBindingRow = typeof assistantGuidanceBindings.$inferSelect

/** One entry with the profiles that currently apply it. */
export interface GuidanceEntryWithUses extends GuidanceEntryRow {
  uses: AssistantAgentKind[]
}

/**
 * What the runtime reads: enough to order, select, prompt and explain.
 *
 * `version` is the canonical entry revision, which the effective snapshot
 * records so a finished run stays explainable after somebody edits the text.
 * A legacy read reports version 0, because the legacy tables have no revision
 * of their own and pretending otherwise would make two different instructions
 * look like the same one.
 */
export interface GuidanceCandidate {
  id: string
  name: string
  appliesWhen: string | null
  instruction: string
  priority: number
  version: number
  createdAt: Date
  updatedAt: Date
  source: 'canonical' | 'legacy'
}

/** A packaged procedure: catalogue line in the prompt, body only on request. */
export interface GuidanceProcedure {
  id: string
  name: string
  whenToUse: string
  body: string
  version: number
  updatedAt: Date
}

function orderedUses(profiles: readonly string[]): AssistantAgentKind[] {
  return GUIDANCE_PROFILES.filter((profile) => profiles.includes(profile))
}

async function attachUses(
  rows: GuidanceEntryRow[],
  execDb: Executor
): Promise<GuidanceEntryWithUses[]> {
  if (rows.length === 0) return []
  const bindings = await execDb
    .select()
    .from(assistantGuidanceBindings)
    .where(
      inArray(
        assistantGuidanceBindings.entryId,
        rows.map((row) => row.id)
      )
    )
  const byEntry = new Map<string, string[]>()
  for (const binding of bindings) {
    if (!binding.enabled) continue
    const list = byEntry.get(binding.entryId) ?? []
    list.push(binding.profile)
    byEntry.set(binding.entryId, list)
  }
  return rows.map((row) => ({ ...row, uses: orderedUses(byEntry.get(row.id) ?? []) }))
}

/**
 * Every entry, in the order the Guidance list shows them.
 *
 * The workspace's own writing guidelines lead, the managed workspace and Slack
 * instructions trail, and everything authored here sits between them in
 * application order. That is the order the compatibility projection used, so
 * the list does not reshuffle itself on the day of the cutover.
 */
export async function listGuidanceEntries(
  execDb: Executor = defaultDb
): Promise<GuidanceEntryWithUses[]> {
  const rows = await execDb
    .select()
    .from(assistantGuidanceEntries)
    .orderBy(
      asc(assistantGuidanceEntries.priority),
      asc(assistantGuidanceEntries.createdAt),
      asc(assistantGuidanceEntries.id)
    )
  const withUses = await attachUses(rows, execDb)
  const rank = (entry: GuidanceEntryWithUses) =>
    entry.legacySource === 'voice' ? 0 : entry.legacySource === 'managed' ? 2 : 1
  return withUses.sort((a, b) => rank(a) - rank(b))
}

export async function getGuidanceEntry(
  id: GuidanceEntryId,
  execDb: Executor = defaultDb
): Promise<GuidanceEntryWithUses | null> {
  const rows = await execDb
    .select()
    .from(assistantGuidanceEntries)
    .where(eq(assistantGuidanceEntries.id, id))
    .limit(1)
  const [withUses] = await attachUses(rows, execDb)
  return withUses ?? null
}

export function toGuidanceEntryDTO(
  entry: GuidanceEntryWithUses,
  managed: boolean
): GuidanceEntryDTO {
  return {
    id: entry.id,
    kind: entry.kind,
    owner: entry.owner,
    title: entry.title,
    body: entry.body,
    appliesWhen: entry.appliesWhen,
    enabled: entry.enabled,
    priority: entry.priority,
    version: entry.version,
    uses: entry.uses,
    legacySource: (entry.legacySource as GuidanceLegacySource | null) ?? null,
    legacyId: entry.legacyId,
    managed,
    updatedAt: entry.updatedAt.toISOString(),
  }
}

/**
 * The bounded candidate list for one profile.
 *
 * Config-owned entries are excluded on purpose: the assistant configuration
 * still owns that text and the prompt still renders it from its own block, so
 * including it here would put the same instruction in the prompt twice.
 */
export async function listCanonicalGuidanceCandidates(
  profile: AssistantAgentKind,
  execDb: Executor = defaultDb
): Promise<GuidanceCandidate[]> {
  const rows = await execDb
    .select({ entry: assistantGuidanceEntries })
    .from(assistantGuidanceEntries)
    .innerJoin(
      assistantGuidanceBindings,
      eq(assistantGuidanceBindings.entryId, assistantGuidanceEntries.id)
    )
    .where(
      and(
        eq(assistantGuidanceEntries.enabled, true),
        eq(assistantGuidanceEntries.owner, 'canonical'),
        inArray(assistantGuidanceEntries.kind, ['always', 'situational']),
        eq(assistantGuidanceBindings.profile, profile),
        eq(assistantGuidanceBindings.enabled, true)
      )
    )
    .orderBy(
      asc(assistantGuidanceEntries.priority),
      asc(assistantGuidanceEntries.createdAt),
      asc(assistantGuidanceEntries.id)
    )
    .limit(GUIDANCE_RUNTIME_BUDGETS.maxCandidates)

  return rows.map(({ entry }) => ({
    id: entry.id,
    name: entry.title,
    appliesWhen: entry.appliesWhen,
    instruction: entry.body,
    priority: entry.priority,
    version: entry.version,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    source: 'canonical' as const,
  }))
}

/** Enabled procedures bound to one profile, oldest first, as the catalogue orders them. */
export async function listCanonicalProcedures(
  profile: AssistantAgentKind,
  execDb: Executor = defaultDb
): Promise<GuidanceProcedure[]> {
  const rows = await execDb
    .select({ entry: assistantGuidanceEntries })
    .from(assistantGuidanceEntries)
    .innerJoin(
      assistantGuidanceBindings,
      eq(assistantGuidanceBindings.entryId, assistantGuidanceEntries.id)
    )
    .where(
      and(
        eq(assistantGuidanceEntries.enabled, true),
        eq(assistantGuidanceEntries.owner, 'canonical'),
        eq(assistantGuidanceEntries.kind, 'procedure'),
        eq(assistantGuidanceBindings.profile, profile),
        eq(assistantGuidanceBindings.enabled, true)
      )
    )
    .orderBy(asc(assistantGuidanceEntries.createdAt), asc(assistantGuidanceEntries.id))

  return rows.map(({ entry }) => ({
    id: entry.id,
    name: entry.title,
    // A procedure always carries its when-to-use line; the table CHECK says so.
    whenToUse: entry.appliesWhen ?? '',
    body: entry.body,
    version: entry.version,
    updatedAt: entry.updatedAt,
  }))
}

function invalidEntry(error: unknown): never {
  const issueMessage =
    typeof error === 'object' && error !== null && 'issues' in error
      ? (error as { issues?: Array<{ message?: string }> }).issues?.[0]?.message
      : undefined
  throw new ValidationError('VALIDATION_ERROR', issueMessage ?? 'Invalid guidance')
}

export interface SaveGuidanceEntryInput {
  id?: string
  expectedVersion?: number
  entry: GuidanceEntryInput
  createdById?: PrincipalId
}

async function writeBindings(
  entryId: string,
  uses: readonly AssistantAgentKind[],
  tx: Executor
): Promise<void> {
  await tx
    .delete(assistantGuidanceBindings)
    .where(eq(assistantGuidanceBindings.entryId, entryId as GuidanceEntryId))
  await tx.insert(assistantGuidanceBindings).values(
    uses.map((profile) => ({
      entryId: entryId as GuidanceEntryId,
      profile,
      enabled: true,
    }))
  )
}

/**
 * Create or update one entry together with the exact set of roles it applies to.
 *
 * An update carries the version it was read at. The row is locked, the version
 * compared and bumped inside the same transaction as the bindings, so two
 * editors cannot interleave a title from one save with the roles from another,
 * and the editor that lost keeps its draft to retry with.
 */
export async function saveGuidanceEntry(
  input: SaveGuidanceEntryInput,
  execDb: Executor = defaultDb
): Promise<GuidanceEntryWithUses> {
  const parsed = guidanceEntryInputSchema.safeParse(input.entry)
  if (!parsed.success) invalidEntry(parsed.error)
  const entry: NormalizedGuidanceEntryInput = parsed.data

  return execDb.transaction(async (tx) => {
    if (!input.id) {
      const [created] = await tx
        .insert(assistantGuidanceEntries)
        .values({
          kind: entry.kind,
          owner: 'canonical',
          title: entry.title,
          body: entry.body,
          appliesWhen: entry.appliesWhen,
          enabled: entry.enabled,
          priority: entry.priority,
          createdById: input.createdById ?? null,
        })
        .returning()
      await writeBindings(created.id, entry.uses, tx)
      return { ...created, uses: orderedUses(entry.uses) }
    }

    const [existing] = await tx
      .select()
      .from(assistantGuidanceEntries)
      .where(eq(assistantGuidanceEntries.id, input.id as GuidanceEntryId))
      .limit(1)
      .for('update')
    if (!existing) {
      throw new NotFoundError(
        'GUIDANCE_ENTRY_NOT_FOUND',
        'This guidance was removed. Reload the list.'
      )
    }
    if (existing.owner === 'config') {
      throw new ValidationError(
        'GUIDANCE_ENTRY_CONFIG_OWNED',
        'These instructions are part of the assistant configuration and are saved there.'
      )
    }
    if (input.expectedVersion === undefined || input.expectedVersion !== existing.version) {
      throw new ConflictError(
        'GUIDANCE_ENTRY_CONFLICT',
        'This guidance changed in another session. Reload it and apply your edit again.'
      )
    }

    const [updated] = await tx
      .update(assistantGuidanceEntries)
      .set({
        kind: entry.kind,
        title: entry.title,
        body: entry.body,
        appliesWhen: entry.appliesWhen,
        enabled: entry.enabled,
        priority: entry.priority,
        version: sql`${assistantGuidanceEntries.version} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(assistantGuidanceEntries.id, existing.id))
      .returning()
    await writeBindings(existing.id, entry.uses, tx)
    return { ...updated, uses: orderedUses(entry.uses) }
  })
}

/** Deleting an entry takes its bindings with it: the cascade is declared on the table. */
export async function deleteGuidanceEntry(
  id: GuidanceEntryId,
  execDb: Executor = defaultDb
): Promise<void> {
  const [existing] = await execDb
    .select({ owner: assistantGuidanceEntries.owner })
    .from(assistantGuidanceEntries)
    .where(eq(assistantGuidanceEntries.id, id))
    .limit(1)
  if (existing?.owner === 'config') {
    throw new ValidationError(
      'GUIDANCE_ENTRY_CONFIG_OWNED',
      'These instructions are part of the assistant configuration and are cleared there.'
    )
  }
  await execDb.delete(assistantGuidanceEntries).where(eq(assistantGuidanceEntries.id, id))
}
