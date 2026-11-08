import { createContext, useContext, useMemo, useSyncExternalStore, type ReactNode } from 'react'
import { useIntl } from 'react-intl'
import type { PortalDesign } from '@/lib/shared/design/schema'
import type { BandImage, DesignLogo, PortalCopy } from '@/lib/shared/design/view'
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
  titles: NonNullable<PortalDesign['pages']['titles']>
  nav: PortalDesign['nav'] | null
}

export const PreviewPagesContext = createContext<PreviewDesignPages | undefined>(undefined)

/** A draft design's Home, or undefined (always, outside a design preview). */
export function usePreviewHome(): PortalDesign['pages']['home'] | undefined {
  return useContext(PreviewPagesContext)?.home ?? undefined
}

/**
 * Whether the page is drawn in the builder while designing: there a Home
 * block whose data has nothing to show draws samples, marked as such, so it
 * can be seen and styled. False everywhere else, the builder's Preview too.
 */
export const PreviewSamplesContext = createContext(false)

export function usePreviewSamples(): boolean {
  return useContext(PreviewSamplesContext)
}

/**
 * What the builder asks the page it designs to show, such as the feed with no
 * posts; nothing outside the builder's canvas, its Preview too.
 */
export function useDesignerPreview(): DesignerPreviewState {
  const designing = usePreviewSamples()
  const state = useSyncExternalStore(
    subscribeDesignerPreview,
    designerPreview,
    () => NO_PREVIEW_STATE
  )
  return designing ? state : NO_PREVIEW_STATE
}

/** A draft design's page titles, or undefined (always, outside a design preview). */
export function usePreviewTitles(): PreviewDesignPages['titles'] | undefined {
  return useContext(PreviewPagesContext)?.titles
}

/** A draft design's menu, or undefined (always, outside a design preview). */
export function usePreviewDesignNav(): PortalDesign['nav'] | undefined {
  return useContext(PreviewPagesContext)?.nav ?? undefined
}

/**
 * The workspace's own wording for the composer, the empty feed and the
 * support page's New request button, by language.
 */
export type FeedCopy = PortalCopy

/**
 * The own wording in force: the portal layout's from the saved design, and
 * the preview's from the draft below it. None outside a portal.
 */
export const FeedCopyContext = createContext<FeedCopy | undefined>(undefined)

/**
 * The own wording in the visitor's language. A language left blank has none,
 * so its strings say the portal's own translation, never another language.
 */
export function useFeedCopy(): {
  prompt?: string
  submit?: string
  emptyTitle?: string
  request?: string
} {
  const copy = useContext(FeedCopyContext)
  const locale = useIntl().locale.toLowerCase()
  return useMemo(
    () => ({
      prompt: copy?.prompt?.[locale] || undefined,
      submit: copy?.submit?.[locale] || undefined,
      emptyTitle: copy?.emptyTitle?.[locale] || undefined,
      request: copy?.request?.[locale] || undefined,
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

// Kept here, in a module every portal page already loads, rather than in a
// module of its own, which the bundler would split into one more request.
/**
 * What the builder asks the page it designs to show as visitors rarely see
 * it, so its words can be edited where they sit: the feed with no posts, and
 * the feed's composer open on its button. Kept outside React, one value per
 * window: the builder holds what its panel asks for and sends it to the
 * frame, which draws it. Never set outside the builder. Plain, so the
 * designer's side of the frame can import it; React reads it through
 * useDesignerPreview in preview-draft-context.
 */
export interface DesignerPreviewState {
  /** The feed drawn as it is with no posts, showing its empty title. */
  empty: boolean
  /** The feed's composer drawn open, showing its button. */
  composer: boolean
}

/** The message the builder sends the frame with what it asks for. */
export const PREVIEW_STATE_MESSAGE = 'quackback:preview-state'
/** The frame's ask for it, once it listens: the builder answers with PREVIEW_STATE_MESSAGE. */
export const PREVIEW_STATE_ASK = 'quackback:preview-state-ask'

const NONE: DesignerPreviewState = { empty: false, composer: false }
let state = NONE
const listeners = new Set<() => void>()

/** Changes what is asked for; only what is named changes. */
export function setDesignerPreview(next: Partial<DesignerPreviewState>): void {
  const merged = { ...state, ...next }
  if (merged.empty === state.empty && merged.composer === state.composer) return
  state = merged
  for (const listener of listeners) listener()
}

export function designerPreview(): DesignerPreviewState {
  return state
}

export function subscribeDesignerPreview(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Nothing asked for: what the server draws. */
export const NO_PREVIEW_STATE = NONE

/** A message from the builder with what it asks for, or null for any other. */
export function readPreviewState(message: unknown): Partial<DesignerPreviewState> | null {
  const data = message as { type?: unknown; empty?: unknown; composer?: unknown } | null
  if (data?.type !== PREVIEW_STATE_MESSAGE) return null
  const read: Partial<DesignerPreviewState> = {}
  if (typeof data.empty === 'boolean') read.empty = data.empty
  if (typeof data.composer === 'boolean') read.composer = data.composer
  return read
}
