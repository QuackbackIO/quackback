/**
 * A design as a portal document applies it: the scoped CSS, the structural
 * attributes and the families to load. The server builds it for published
 * and converted designs; the Appearance preview builds it for the draft with
 * the same code, so the preview cannot drift from what visitors get.
 *
 * Kept apart from view.ts, which every portal page imports, so the resolver
 * ships only where a design is resolved.
 */
import { layoutAttributes } from './components'
import { designFontIds, fontStack } from './fonts'
import { renderDesignCss, resolveDesign } from './resolve'
import type { PortalDesign } from './schema'
import type { PortalDesignView } from './view'
import { isEmptyTiptapDoc } from '@/lib/shared/utils/is-empty-tiptap-doc'
import type { TiptapContent } from '@/lib/shared/db-types'

export function designView(
  doc: PortalDesign,
  revision: number | null
): Extract<PortalDesignView, { engine: 'v2' }> {
  return {
    engine: 'v2',
    mode: doc.mode,
    revision,
    themeStyles: renderDesignCss(resolveDesign(doc)),
    customCss: doc.css ? `@layer tenant {\n${doc.css}\n}` : '',
    fontSans: fontStack(doc.brand.fonts.body),
    fontIds: designFontIds(doc),
    attributes: layoutAttributes(doc),
    feedback: {
      welcome: feedbackWelcome(doc),
      headline: doc.pages.feedback.headline,
    },
  }
}

function feedbackWelcome(doc: PortalDesign): TiptapContent | null {
  const { show, body } = doc.pages.feedback.welcome
  return show && !isEmptyTiptapDoc(body as TiptapContent) ? (body as TiptapContent) : null
}
