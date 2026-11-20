import { createContext, useContext, useMemo, type ReactNode } from 'react'
import type {
  HeaderDisplayMode,
  HelpCenterHeaderLink,
  PortalNavConfig,
  PortalWelcomeCard,
} from '@/lib/shared/types/settings'
import type { ButtonShape, CardStyle, CustomFont, HeadingScope } from '@/lib/shared/theme'

/** The Help Center home as the Customise page edits it (top-level fields only). */
export interface PreviewHelpCenterDraft {
  homepageTitle?: string
  homepageDescription?: string
  headerLinks?: HelpCenterHeaderLink[]
}

/** The header logo the draft shows: its address and how the header draws it. */
export interface PreviewLogoDraft {
  url: string | null
  /** The wide logo's dark mode version, when the draft has one and the header shows the wide logo. */
  darkUrl?: string | null
  mode: HeaderDisplayMode
}

/**
 * Unsaved admin drafts injected into the portal preview iframe (see
 * PortalPreviewProvider). Raw config shapes, not resolved render output —
 * consumers resolve with their own gates so a draft can never force-show
 * something the viewer couldn't see.
 */
export interface PortalPreviewDraft {
  nav?: PortalNavConfig
  welcomeCard?: PortalWelcomeCard
  helpCenter?: PreviewHelpCenterDraft
  logo?: PreviewLogoDraft
  /**
   * Its own field, never part of `css`: the draft stylesheet is generated
   * theme CSS, and anything else in it would read as Advanced CSS.
   */
  buttonShape?: ButtonShape
  /**
   * An uploaded font, its own field for the same reason: the frame writes its
   * faces and puts the family ahead of the stylesheet's font.
   */
  customFont?: CustomFont
  /** The card style and an uploaded headings font, their own fields likewise. */
  cardStyle?: CardStyle
  customHeadingFont?: CustomFont
  /** 'page' keeps the headings font to page headings. */
  headingScope?: HeadingScope
  /** The workspace's name, as the header shows it beside the icon. */
  name?: string
  /**
   * The theme editor's live draft stylesheet (raw `:root { --font-sans: ...
   * }` text, same shape as saved customCss). Exposed so useBrandingFont can
   * dynamically load the family the admin is previewing — without this, the
   * live preview would only ever load the last *saved* font, not the one
   * currently being tried in the picker.
   */
  css?: string
}

/** The parts of the portal the Customise page opens a section for (`data-qb-edit`). */
export type PreviewEditTarget =
  'header' | 'logo' | 'nav' | 'welcome' | 'hc-home' | 'colours' | 'type'

/**
 * Labels for the clickable parts, sent by the Customise page with edit mode,
 * so the admin's words stay in the admin.
 */
export type PreviewEditLabels = Partial<Record<PreviewEditTarget, string>>

const PreviewDraftContext = createContext<PortalPreviewDraft | null>(null)
// One context per draft field as well, so a component that reads one field
// re-renders only when that field changes: a stylesheet edit must not
// re-render the portal home, which reads only the welcome card.
const PreviewNavContext = createContext<PortalNavConfig | undefined>(undefined)
const PreviewWelcomeCardContext = createContext<PortalWelcomeCard | undefined>(undefined)
const PreviewHelpCenterContext = createContext<PreviewHelpCenterDraft | undefined>(undefined)
const PreviewLogoContext = createContext<PreviewLogoDraft | undefined>(undefined)
const PreviewNameContext = createContext<string | undefined>(undefined)
const PreviewCssContext = createContext<string | undefined>(undefined)
const PreviewEditModeContext = createContext<PreviewEditLabels | null>(null)

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
          <PreviewHelpCenterContext.Provider value={draft?.helpCenter}>
            <PreviewLogoContext.Provider value={draft?.logo}>
              <PreviewNameContext.Provider value={draft?.name}>
                <PreviewCssContext.Provider value={css || undefined}>
                  {children}
                </PreviewCssContext.Provider>
              </PreviewNameContext.Provider>
            </PreviewLogoContext.Provider>
          </PreviewHelpCenterContext.Provider>
        </PreviewWelcomeCardContext.Provider>
      </PreviewNavContext.Provider>
    </PreviewDraftContext.Provider>
  )
}

/**
 * Edit mode, which the Customise page turns on in its frame: parts of the page
 * become clickable. Off everywhere else, the summary page's thumbnail included.
 */
export function PreviewEditModeProvider({
  labels,
  children,
}: {
  labels: PreviewEditLabels | null
  children: ReactNode
}) {
  return (
    <PreviewEditModeContext.Provider value={labels}>{children}</PreviewEditModeContext.Provider>
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

/** The unsaved Help Center home, or undefined (always, outside the preview). */
export function usePreviewHelpCenter(): PreviewHelpCenterDraft | undefined {
  return useContext(PreviewHelpCenterContext)
}

/** The unsaved header logo, or undefined (always, outside the preview). */
export function usePreviewLogo(): PreviewLogoDraft | undefined {
  return useContext(PreviewLogoContext)
}

/** The unsaved workspace name, or undefined (always, outside the preview). */
export function usePreviewName(): string | undefined {
  return useContext(PreviewNameContext)
}

/** The theme editor's unsaved stylesheet, or undefined when there is none. */
export function usePreviewCss(): string | undefined {
  return useContext(PreviewCssContext)
}

/** The edit-mode labels while the Customise page has edit mode on, else null. */
export function usePreviewEditMode(): PreviewEditLabels | null {
  return useContext(PreviewEditModeContext)
}
