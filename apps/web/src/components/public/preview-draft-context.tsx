import { createContext, useContext, useMemo, useSyncExternalStore, type ReactNode } from 'react'
import { useIntl } from 'react-intl'
import { useRouteContext } from '@tanstack/react-router'
import type { PageChoices } from '@/lib/shared/design/page-choices'
import type { PortalCopy, PortalDesignView } from '@/lib/shared/design/view'
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

/** A design as a portal page draws it: the published one, or the builder's draft in its frame. */
export type DraftDesignView = Extract<PortalDesignView, { engine: 'v2' }>

/**
 * The builder's draft as the portal reads it: the view the server would build
 * for it, built in the frame with the same code (see PortalPreviewProvider).
 * Undefined everywhere but the builder's frame, which provides it.
 */
export const PreviewDesignContext = createContext<DraftDesignView | undefined>(undefined)

/**
 * The design the portal draws: the builder's draft while its frame previews
 * one, else the published design from the route context. Every part of the
 * portal that reads the design reads it here, so the canvas draws a draft
 * through the same code that draws it once published.
 */
export function usePortalDesign(): PortalDesignView | undefined {
  const draft = useContext(PreviewDesignContext)
  const saved = useRouteContext({
    from: '__root__',
    select: (context) => context.settings?.portalDesign,
  })
  return draft ?? saved
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

/**
 * The workspace's own wording for the composer, the empty feed and the
 * support page's New request button, by language.
 */
export type FeedCopy = PortalCopy

/**
 * The own wording in force, from the design the portal draws (the builder's
 * draft in its frame), provided by PortalPreviewProvider. None outside a portal.
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

/** The builder's message with the theme to draw in, light or dark, in place of a reload. */
export const PREVIEW_THEME = 'quackback:preview-theme'

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

// The page choices as the portal reads them, kept in a module every portal
// page loads already: page-choices.ts holds them as zod schemas over the
// design options, which a visitor's page has no use for and which would
// split into several more scripts. Tests hold these lists equal to the schemas.

type ChoiceValue = string | number | boolean
/** Each page choice's allowed values; `boolean` for a switch. */
export const PAGE_CHOICE_VALUES = {
  changelog: {
    entries: ['timeline', 'cards', 'compact'],
    images: ['none', 'wide', 'thumbnail'],
    subscribe: ['beside', 'under'],
    shipped: 'boolean',
  },
  help: {
    topics: ['cards', 'list'],
    popular: 'boolean',
    search: ['standard', 'large'],
    helpful: 'boolean',
    related: [0, 2, 4],
    contact: 'boolean',
  },
  roadmap: { board: ['columns', 'list'] },
  post: {
    vote: ['title', 'details'],
    board: 'boolean',
    tags: 'boolean',
    date: 'boolean',
    author: 'boolean',
    subscribe: ['details', 'comments'],
    comments: ['newest', 'oldest'],
  },
  support: { suggest: 'boolean' },
} as const satisfies Record<keyof PageChoices, Record<string, 'boolean' | readonly ChoiceValue[]>>

/** Today's pages: what a design without choices draws (PAGE_CHOICE_DEFAULTS). */
export const PORTAL_PAGE_CHOICES: PageChoices = {
  changelog: { entries: 'timeline', images: 'none', subscribe: 'beside', shipped: true },
  help: {
    topics: 'cards',
    popular: true,
    search: 'standard',
    helpful: true,
    related: 4,
    contact: false,
  },
  roadmap: { board: 'columns' },
  post: {
    vote: 'title',
    board: true,
    tags: true,
    date: true,
    author: true,
    subscribe: 'details',
    comments: 'newest',
  },
  support: { suggest: true },
}

/** The page choices in force, from the design's attributes; anything absent or unknown is today's. */
export function readPortalPageChoices(
  attributes: Readonly<Record<string, string>> | undefined
): PageChoices {
  const out = {} as Record<string, Record<string, ChoiceValue>>
  for (const page of Object.keys(PORTAL_PAGE_CHOICES) as Array<keyof PageChoices>) {
    const defaults = PORTAL_PAGE_CHOICES[page] as Record<string, ChoiceValue>
    const allowed = PAGE_CHOICE_VALUES[page] as Record<string, 'boolean' | readonly ChoiceValue[]>
    const read: Record<string, ChoiceValue> = {}
    for (const [key, fallback] of Object.entries(defaults)) {
      const raw = attributes?.[`data-qb-${page}-${key}`]
      const values = allowed[key]
      let value: ChoiceValue | undefined
      if (values === 'boolean') value = raw === 'on' ? true : raw === 'off' ? false : undefined
      else if (raw !== undefined) {
        const parsed = typeof fallback === 'number' ? Number(raw) : raw
        value = values?.includes(parsed) ? parsed : undefined
      }
      read[key] = value ?? fallback
    }
    out[page] = read
  }
  return out as unknown as PageChoices
}

/**
 * The Changelog, Help Center, Roadmap, Support and post pages' choices: the
 * draft's while the designer previews one, else the published design's.
 * Without a design, or without a choice, each page is drawn as it always was.
 */
export function usePageChoices(): PageChoices {
  const design = usePortalDesign()
  const attributes = design?.engine === 'v2' ? design.attributes : undefined
  return useMemo(() => readPortalPageChoices(attributes), [attributes])
}

/**
 * Where a post draws its one vote control: beside the title at every width,
 * or in the details, which wide screens alone show, so beside the title on
 * narrower ones. Where the control is beside the title, the details show the
 * count alone over the team's voters list, or nothing.
 */
export function postVotePlaces(
  vote: PageChoices['post']['vote'],
  voters: boolean
): { title: 'always' | 'narrow'; details: 'button' | 'count' | 'none' } {
  if (vote === 'details') return { title: 'narrow', details: 'button' }
  return { title: 'always', details: voters ? 'count' : 'none' }
}
