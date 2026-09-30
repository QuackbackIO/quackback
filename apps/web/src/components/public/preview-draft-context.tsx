import { createContext, useContext, useMemo, type ReactNode } from 'react'
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
