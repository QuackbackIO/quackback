/**
 * What the Appearance view and the API call to edit a portal design. Each
 * refusal a caller must explain is returned as a value, not thrown: a thrown
 * error reaches the browser as a bare message, without its code.
 */
import { createHash } from 'node:crypto'
import type { PortalDesignRevisionId } from '@quackback/ids'
import type { PortalDesignSource } from '@/lib/server/db'
import { DomainException } from '@/lib/shared/errors'
import { convertLegacyBranding } from '@/lib/shared/design/convert'
import { mergePatch } from '@/lib/shared/design/merge-patch'
import { resolveDesign, type DesignAdjustment } from '@/lib/shared/design/resolve'
import type { PortalDesign } from '@/lib/shared/design/schema'
import { getWorkspaceSettings } from '@/lib/server/domains/settings/settings.service'
import {
  discardDraft,
  getDesignState,
  listRevisions,
  publishDraft,
  restoreRevision,
  saveDraft,
  type DesignAuthor,
} from './design.service'
import { legacyBrandingOf } from './engine'
import { lintDesignCss, type CssIssue } from './css-lint'

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

async function convertedDesign(): Promise<PortalDesign> {
  const settings = await getWorkspaceSettings()
  const row = settings?.settings ?? {}
  return convertLegacyBranding(
    legacyBrandingOf({
      ...row,
      brandingConfig: settings?.brandingConfig ?? null,
      portalConfig: settings?.portalConfig,
      customCss: settings?.customCss,
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
  const revision = createHash('sha256')
    .update(JSON.stringify({ published: published?.number ?? null, draft: state?.draft ?? null }))
    .digest('hex')
    .slice(0, 32)
  return { design, source, live, published, report: reportOf(design), revision }
}

/**
 * Applies a JSON merge patch to the design being edited and saves the result
 * as the draft. With `expectedRevision`, a patch made against an older state
 * is refused.
 */
export async function patchDesignDraft(
  patch: unknown,
  author: DesignAuthor,
  expectedRevision?: string
): Promise<{ ok: true; report: DesignReport } | DesignRefusal> {
  const current = await readDesignForEditing()
  if (expectedRevision && expectedRevision !== current.revision) {
    return {
      ok: false,
      code: 'REVISION_MISMATCH',
      message: 'The design changed since you read it. Read it again, then send the patch.',
    }
  }
  return saveDesignDraft(mergePatch(current.design, patch), author)
}

export async function saveDesignDraft(
  input: unknown,
  author: DesignAuthor
): Promise<{ ok: true; report: DesignReport } | DesignRefusal> {
  return refusable(async () => {
    await saveDraft(input, author)
    const state = await getDesignState()
    return { ok: true as const, report: reportOf(state!.draft!) }
  })
}

export async function discardDesignDraft(): Promise<{ ok: true }> {
  await discardDraft()
  return { ok: true }
}

export async function publishDesign(
  input: DesignAuthor & { source: PortalDesignSource; message?: string }
): Promise<{ ok: true; revisionId: PortalDesignRevisionId; number: number } | DesignRefusal> {
  return refusable(async () => ({ ok: true as const, ...(await publishDraft(input)) }))
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
