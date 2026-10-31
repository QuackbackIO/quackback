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
import { rewritePartAliases } from './parts'
import { designFontIds, fontStack, uploadedFontFaces } from './fonts'
import { renderDesignCss, resolveDesign } from './resolve'
import type { PortalDesign } from './schema'
import type { DesignLogo, PortalDesignView } from './view'
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
    themeStyles: [uploadedFontFaces(doc), renderDesignCss(resolveDesign(doc))]
      .filter(Boolean)
      .join(' '),
    customCss: doc.css ? `@layer tenant {\n${rewritePartAliases(doc.css)}\n}` : '',
    fontSans: fontStack(doc.brand.fonts.body),
    fontIds: designFontIds(doc),
    attributes: layoutAttributes(doc),
    feedback: {
      welcome: feedbackWelcome(doc),
      headline: doc.pages.feedback.headline,
      defaultSort: doc.pages.feedback.defaultSort,
      copy: doc.pages.feedback.copy,
    },
    home: doc.pages.home,
    nav: doc.nav,
    vocabulary: doc.vocabulary,
    logo: designLogo(doc),
  }
}

/** Where the portal loads a stored brand file from: its own origin. */
export const designAssetUrl = (key: string) => `/api/storage/${key}`

function designLogo(doc: PortalDesign): DesignLogo {
  const { display, name, wordmark } = doc.brand.logo
  return {
    display,
    name: name ?? null,
    wordmark: {
      light: wordmark.light ? designAssetUrl(wordmark.light.key) : null,
      dark: wordmark.dark ? designAssetUrl(wordmark.dark.key) : null,
    },
  }
}

function feedbackWelcome(doc: PortalDesign): TiptapContent | null {
  const { show, body } = doc.pages.feedback.welcome
  return show && !isEmptyTiptapDoc(body as TiptapContent) ? (body as TiptapContent) : null
}
