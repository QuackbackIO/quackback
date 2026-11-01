import { createContext, useContext, useMemo, type ReactNode } from 'react'
import { useIntl } from 'react-intl'
import type { PortalDesign } from '@/lib/shared/design/schema'
import type { BandImage, DesignLogo } from '@/lib/shared/design/view'
import type { PortalNavConfig, PortalWelcomeCard } from '@/lib/shared/types/settings'

/**
 * Unsaved admin drafts injected into the portal preview iframe (see
 * PortalPreviewProvider). Raw config shapes, not resolved render output —
 * consumers resolve with their own gates so a draft can never force-show
 * something the viewer couldn't see.
 */
export interface PortalPreviewDraft {
  nav?: PortalNavConfig
  welcomeCard?: PortalWelcomeCard
  /**
   * The theme editor's live draft stylesheet (raw `:root { --font-sans: ...
   * }` text, same shape as saved customCss). Exposed so useBrandingFont can
   * dynamically load the family the admin is previewing — without this, the
   * live preview would only ever load the last *saved* font, not the one
   * currently being tried in the picker.
   */
  css?: string
}

const PreviewDraftContext = createContext<PortalPreviewDraft | null>(null)
// One context per draft field as well, so a component that reads one field
// re-renders only when that field changes: a stylesheet edit must not
// re-render the portal home, which reads only the welcome card.
const PreviewNavContext = createContext<PortalNavConfig | undefined>(undefined)
const PreviewWelcomeCardContext = createContext<PortalWelcomeCard | undefined>(undefined)
const PreviewCssContext = createContext<string | undefined>(undefined)

/**
 * Provides the preview's drafts: the structural draft (whose fields keep their
 * identity while unchanged, see PortalPreviewProvider) and the draft
 * stylesheet, where an empty one means none.
 */
export function PreviewDraftProvider({
  draft,
  css,
  children,
}: {
  draft: Omit<PortalPreviewDraft, 'css'> | null
  css: string
  children: ReactNode
}) {
  const combined = useMemo(() => (draft || css ? { ...draft, css } : null), [draft, css])
  return (
    <PreviewDraftContext.Provider value={combined}>
      <PreviewNavContext.Provider value={draft?.nav}>
        <PreviewWelcomeCardContext.Provider value={draft?.welcomeCard}>
          <PreviewCssContext.Provider value={css || undefined}>
            {children}
          </PreviewCssContext.Provider>
        </PreviewWelcomeCardContext.Provider>
      </PreviewNavContext.Provider>
    </PreviewDraftContext.Provider>
  )
}

/**
 * The current preview draft, or null everywhere outside the admin
 * branding-preview iframe (the provider only mounts in preview mode, so
 * normal portal renders pay nothing). It changes with any field; a component
 * that reads one field re-renders less with that field's own hook below.
 */
export function usePreviewDraft(): PortalPreviewDraft | null {
  return useContext(PreviewDraftContext)
}

/** The unsaved navigation, or undefined (always, outside the preview). */
export function usePreviewNav(): PortalNavConfig | undefined {
  return useContext(PreviewNavContext)
}

/** The unsaved welcome card, or undefined (always, outside the preview). */
export function usePreviewWelcomeCard(): PortalWelcomeCard | undefined {
  return useContext(PreviewWelcomeCardContext)
}

/** The theme editor's unsaved stylesheet, or undefined when there is none. */
export function usePreviewCss(): string | undefined {
  return useContext(PreviewCssContext)
}

/** A draft design's page headline: undefined outside a design preview, null when it has none. */
export type PreviewHeadline = NonNullable<PortalDesign['pages']['feedback']['headline']> | null

export const PreviewHeadlineContext = createContext<PreviewHeadline | undefined>(undefined)

/** The draft design's feedback page headline, or undefined (always, outside a design preview). */
export function usePreviewHeadline(): PreviewHeadline | undefined {
  return useContext(PreviewHeadlineContext)
}

/** A draft design's Home and menu, as the design stores them. */
export type PreviewDesignPages = {
  home: PortalDesign['pages']['home'] | null
  nav: PortalDesign['nav'] | null
}

export const PreviewPagesContext = createContext<PreviewDesignPages | undefined>(undefined)

/** A draft design's Home, or undefined (always, outside a design preview). */
export function usePreviewHome(): PortalDesign['pages']['home'] | undefined {
  return useContext(PreviewPagesContext)?.home ?? undefined
}

/** A draft design's menu, or undefined (always, outside a design preview). */
export function usePreviewDesignNav(): PortalDesign['nav'] | undefined {
  return useContext(PreviewPagesContext)?.nav ?? undefined
}

/** The workspace's own wording for the composer and the empty feed, by language. */
export type FeedCopy = PortalDesign['pages']['feedback']['copy']

/**
 * The own wording in force: the portal layout's from the saved design, and
 * the preview's from the draft below it. None outside a portal.
 */
export const FeedCopyContext = createContext<FeedCopy | undefined>(undefined)

/**
 * The own wording in the visitor's language. A language left blank has none,
 * so its strings say the chosen word's translation, never another language.
 */
export function useFeedCopy(): { prompt?: string; submit?: string; emptyTitle?: string } {
  const copy = useContext(FeedCopyContext)
  const locale = useIntl().locale.toLowerCase()
  return useMemo(
    () => ({
      prompt: copy?.prompt?.[locale] || undefined,
      submit: copy?.submit?.[locale] || undefined,
      emptyTitle: copy?.emptyTitle?.[locale] || undefined,
    }),
    [copy, locale]
  )
}

export const PreviewBandImageContext = createContext<BandImage | null | undefined>(undefined)

/** A draft design's band image: undefined outside a design preview, null when it has none. */
export function usePreviewBandImage(): BandImage | null | undefined {
  return useContext(PreviewBandImageContext)
}

export const PreviewLogoContext = createContext<DesignLogo | undefined>(undefined)

/** A draft design's logo, or undefined (always, outside a design preview). */
export function usePreviewLogo(): DesignLogo | undefined {
  return useContext(PreviewLogoContext)
}

export const PreviewAttributesContext = createContext<Record<string, string> | undefined>(undefined)

/** A draft design's structural attributes, or undefined (always, outside a design preview). */
export function usePreviewDesignAttributes(): Record<string, string> | undefined {
  return useContext(PreviewAttributesContext)
}
