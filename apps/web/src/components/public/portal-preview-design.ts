/**
 * The builder's preview channel inside the frame: the draft design it posts,
 * validated with the schema the server saves designs with and turned into a
 * view with designView, the code the server builds the published view with.
 * The portal then reads that view where it reads the published one, so the
 * canvas has no render path of its own to drift.
 *
 * Only the preview frame needs it (it carries the design schema and the
 * resolver), so the listener loads it when the first design arrives and no
 * visitor downloads it.
 */

import { designView, previewStylesheet } from '@/lib/shared/design/design-view'
import { portalDesign } from '@/lib/shared/design/schema'
import type { DraftDesignView } from './preview-draft-context'

/** A file from the workspace's own storage, the only place a draft's images may come from. */
const STORED_FILE = /^\/api\/storage\/[\w./-]+$/

const storedFile = (url: string | null) => (url && STORED_FILE.test(url) ? url : null)

/**
 * The view keeping only images from the workspace's storage. The schema takes
 * any file key, and a key is what the address is built from, so one that
 * would leave storage (a query, a stray character) is dropped here. Only the
 * images the page draws are checked; the head's icons stay the published ones.
 */
function storedFilesOnly(view: DraftDesignView): DraftDesignView {
  const { logo, bandImage } = view
  return {
    ...view,
    logo: {
      ...logo,
      wordmark: { light: storedFile(logo.wordmark.light), dark: storedFile(logo.wordmark.dark) },
      ...(logo.mark
        ? { mark: { light: storedFile(logo.mark.light), dark: storedFile(logo.mark.dark) } }
        : {}),
    },
    // Its smaller copies' keys are held to plain path characters by the schema.
    bandImage: bandImage && STORED_FILE.test(bandImage.url) ? bandImage : null,
  }
}

/**
 * The draft's view, as the server would build it once published, or null
 * when the message holds no design the schema accepts. Nothing from the
 * message is used before the schema has read it.
 */
export function readDraftView(value: unknown): DraftDesignView | null {
  if (value === null || value === undefined) return null
  const parsed = portalDesign.safeParse(value)
  if (!parsed.success) return null
  return storedFilesOnly(designView(parsed.data, null))
}

/** The stylesheet the frame draws a view with (the builder waits for this very text). */
export const draftStylesheet = previewStylesheet

/** Sets the attributes on <html> and returns what puts each one's saved value back. */
export function applyDesignAttributes(attributes: Record<string, string>): () => void {
  const root = document.documentElement
  const saved = Object.keys(attributes).map((name) => [name, root.getAttribute(name)] as const)
  for (const [name, value] of Object.entries(attributes)) root.setAttribute(name, value)
  return () => {
    for (const [name, value] of saved) {
      if (value === null) root.removeAttribute(name)
      else root.setAttribute(name, value)
    }
  }
}

/** Outlines the innermost section under the pointer, so it reads as clickable. */
export const SECTION_OUTLINE_CSS =
  '[data-qb-section]{cursor:pointer}' +
  '[data-qb-section]:hover:not(:has([data-qb-section]:hover)){outline:2px dashed oklch(0.55 0 0 / 0.7);outline-offset:4px}'

/**
 * A click on a section (not on one of its links, buttons or fields) tells
 * Appearance which section to open. Returns what stops listening.
 */
export function startSectionPicking(): () => void {
  function onClick(event: MouseEvent) {
    const target = event.target as Element | null
    if (!target || target.closest('a, button, input, textarea, select, [role="button"]')) return
    const section = target.closest('[data-qb-section]')?.getAttribute('data-qb-section')
    if (!section) return
    event.preventDefault()
    window.parent.postMessage(
      { type: 'quackback:preview-section', section },
      window.location.origin
    )
  }
  document.addEventListener('click', onClick, true)
  return () => document.removeEventListener('click', onClick, true)
}
