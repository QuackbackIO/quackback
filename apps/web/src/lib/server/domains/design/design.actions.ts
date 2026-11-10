/**
 * What the Appearance view and the API call to edit a portal design. Each
 * refusal a caller must explain is returned as a value, not thrown: a thrown
 * error reaches the browser as a bare message, without its code.
 */
import { readRevision } from './revisions'
import { draftLastChange, type DraftLastChange } from './draft-last-change'
import { currentAuthors } from './draft-authors'
import { authorNames } from './draft-author-names'
import type { PortalDesignRevisionId } from '@quackback/ids'
import { db, type PortalDesignSource } from '@/lib/server/db'
import { DomainException } from '@/lib/shared/errors'
import { convertLegacyBranding } from '@/lib/shared/design/convert'
import { designChanges } from '@/lib/shared/design/diff'
import { withBlockIds } from '@/lib/shared/design/home'
import { mergePatch } from '@/lib/shared/design/merge-patch'
import { tidyDesign, withHeroKeys } from '@/lib/shared/design/migrations'
import { resolveDesign, type DesignAdjustment } from '@/lib/shared/design/resolve'
import type { PortalDesign } from '@/lib/shared/design/schema'
import { parseJsonOrNull, parsePortalConfig } from '@/lib/server/domains/settings/settings.helpers'
import type { BrandingConfig } from '@/lib/server/domains/settings/settings.types'
import {
  discardDraft,
  getDesignState,
  listRevisions,
  publishDraft,
  restoreRevision,
  saveDraft,
  type DesignAuthor,
} from './design.service'
import { EMPTY_REVISION } from './draft-revision'
import { legacyBrandingOf } from './engine'
import { lintDesignCss, type CssIssue } from './css-lint'
import { publishDraftWithWorkspaceLogo } from './workspace-logo'

const REFUSAL_CODES = [
  'INVALID_DESIGN',
  'UNREADABLE_DESIGN',
  'DESIGN_CHANGED',
  'NO_DRAFT',
  'REVISION_NOT_FOUND',
  'REVISION_MISMATCH',
  'DRAFT_CHANGED',
  'INVALID_CSS',
  'TIER_LIMIT_EXCEEDED',
  'NOT_SWITCHABLE',
  'NOT_SWITCHED',
  'NO_PORTAL_LOGO',
] as const
export type DesignRefusalCode = (typeof REFUSAL_CODES)[number]
export type DesignRefusal = { ok: false; code: DesignRefusalCode; message: string }

/** What the contrast solver changed and what it could not fix, and what the CSS check warns about. */
export interface DesignReport {
  adjustments: DesignAdjustment[]
  errors: string[]
  css: CssIssue[]
}

export interface DesignEditorState {
  /** The design being edited: the draft, else the published design, else today's branding. */
  design: PortalDesign
  source: 'draft' | 'published' | 'converted'
  /** What visitors see now: the published design, else today's branding converted. */
  live: PortalDesign
  published: { revisionId: PortalDesignRevisionId; number: number } | null
  report: DesignReport
  /** Moves whenever the draft or the published version moves; the REST API's ETag. */
  revision: string
  /** Who made each change the draft makes, by its path: a name, or Quackback AI. */
  authors: Record<string, string>
  /** When the draft was last saved, or null without a draft. */
  draftSavedAt: string | null
  /** How many changes the draft waits to publish; 0 without a draft. */
  waiting: number
}

function reportOf(doc: PortalDesign): DesignReport {
  const { adjustments, errors } = resolveDesign(doc)
  return { adjustments, errors, css: doc.css ? lintDesignCss(doc.css).warnings : [] }
}

/** Runs a write, turning a refusal a person can act on into a value. */
export async function refusable<T>(write: () => Promise<T>): Promise<T | DesignRefusal> {
  try {
    return await write()
  } catch (error) {
    if (
      error instanceof DomainException &&
      (REFUSAL_CODES as readonly string[]).includes(error.code)
    ) {
      return { ok: false, code: error.code as DesignRefusalCode, message: error.message }
    }
    throw error
  }
}

/**
 * The workspace's branding as a design, converted from its settings row as
 * portal pages convert it before the first publish: what visitors see then.
 */
async function convertedDesign(): Promise<PortalDesign> {
  const row = await db.query.settings.findFirst()
  return convertLegacyBranding(
    legacyBrandingOf({
      ...row,
      brandingConfig: parseJsonOrNull<BrandingConfig>(row?.brandingConfig ?? null),
      portalConfig: parsePortalConfig(row?.portalConfig ?? null),
      customCss: row?.customCss,
    })
  )
}

export async function readDesignForEditing(): Promise<DesignEditorState> {
  const state = await getDesignState()
  const published = state?.published
    ? { revisionId: state.published.revisionId, number: state.published.number }
    : null
  const live = state?.published?.document ?? (await convertedDesign())
  const [design, source] = state?.draft
    ? ([state.draft, 'draft'] as const)
    : ([live, state?.published ? 'published' : 'converted'] as const)
  const revision = state?.revision ?? EMPTY_REVISION
  // Blocks without ids take the same ones on both sides, so ids are no change.
  const [shown, shownLive] = [withBlockIds(design), withBlockIds(live)]
  const authors = await authorNames(currentAuthors(state?.authors ?? null, shownLive, shown))
  return {
    design: shown,
    source,
    live: shownLive,
    published,
    report: reportOf(design),
    revision,
    authors,
    draftSavedAt: state?.draftSavedAt?.toISOString() ?? null,
    waiting: source === 'draft' ? designChanges(shownLive, shown).length : 0,
  }
}

/**
 * The design being edited and its revision, for a change made on the server,
 * such as by Quackback AI: what readDesignForEditing gives, without the live
 * design, the report or who made each change, which such a change never shows.
 */
export async function readDraftForChange(): Promise<
  Pick<DesignEditorState, 'design' | 'revision'>
> {
  const state = await getDesignState()
  const design = state?.draft ?? state?.published?.document ?? (await convertedDesign())
  return { design: withBlockIds(design), revision: state?.revision ?? EMPTY_REVISION }
}

/**
 * Applies a JSON merge patch to the design being edited and saves the result
 * as the draft. With `expectedRevision`, a patch made against an older state
 * is refused. A patch written for format 2, naming the hero's keys as a band
 * (layout.bandShape), still applies: its keys take format 3's names first.
 */
export async function patchDesignDraft(
  patch: unknown,
  author: DesignAuthor,
  expectedRevision?: string
): Promise<{ ok: true; report: DesignReport } | DesignRefusal> {
  const current = await readDraftForChange()
  // The save checks the revision under the draft's lock, so a change landing
  // between this read and that save is refused too.
  const named =
    patch !== null && typeof patch === 'object' && !Array.isArray(patch)
      ? withHeroKeys(patch as Record<string, unknown>)
      : patch
  // Keys written as format 2 had them (one card look, Lift as a motion) are tidied as a stored design's are.
  const merged = mergePatch(current.design, named)
  const tidied =
    merged !== null && typeof merged === 'object' && !Array.isArray(merged)
      ? tidyDesign(merged as Record<string, unknown>)
      : merged
  return saveDesignDraft(tidied, author, expectedRevision)
}

/**
 * Saves the draft and returns its report and new revision. With
 * `expectedRevision`, a save against a draft someone else has changed since
 * is refused, saying who changed it and when.
 */
export async function saveDesignDraft(
  input: unknown,
  author: DesignAuthor,
  expectedRevision?: string
): Promise<
  | { ok: true; report: DesignReport; revision: string }
  | (DesignRefusal & { lastChange?: DraftLastChange | null })
> {
  const result = await refusable(async () => {
    const revision = await saveDraft(input, author, expectedRevision, convertedDesign)
    const state = await getDesignState()
    // A draft put back to what visitors see is gone, and what they see is what it was.
    const saved = state?.draft ?? state?.published?.document ?? (await convertedDesign())
    return { ok: true as const, report: reportOf(saved), revision }
  })
  if (result.ok || result.code !== 'REVISION_MISMATCH') return result
  return { ...result, lastChange: await draftLastChange(author.principalId) }
}

export async function discardDesignDraft(): Promise<{ ok: true }> {
  await discardDraft()
  return { ok: true }
}

export async function publishDesign(
  input: DesignAuthor & {
    source: PortalDesignSource
    message?: string
    expectedRevision?: string
    /** Also makes the draft's portal logo the workspace's, for the admin and emails. */
    workspaceLogo?: boolean
  }
): Promise<{ ok: true; revisionId: PortalDesignRevisionId; number: number } | DesignRefusal> {
  const { workspaceLogo, ...publish } = input
  return refusable(async () => ({
    ok: true as const,
    ...(await (workspaceLogo ? publishDraftWithWorkspaceLogo(publish) : publishDraft(publish))),
  }))
}

export async function restoreDesign(
  revisionId: PortalDesignRevisionId,
  author: DesignAuthor
): Promise<{ ok: true; revisionId: PortalDesignRevisionId; number: number } | DesignRefusal> {
  return refusable(async () => ({
    ok: true as const,
    ...(await restoreRevision(revisionId, author)),
  }))
}

export async function listDesignVersions() {
  return listRevisions()
}

/** One published version's design, to look at or copy into the draft. */
export async function readDesignVersion(
  revisionId: PortalDesignRevisionId
): Promise<{ ok: true; design: PortalDesign; number: number } | DesignRefusal> {
  const found = await readRevision(revisionId)
  return found
    ? { ok: true, design: found.document, number: found.number }
    : { ok: false, code: 'REVISION_NOT_FOUND', message: 'That version no longer exists.' }
}
