import { createContext, useContext } from 'react'
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
}

const PreviewDraftContext = createContext<PortalPreviewDraft | null>(null)

export const PreviewDraftProvider = PreviewDraftContext.Provider

/**
 * The current preview draft, or null everywhere outside the admin
 * branding-preview iframe (the provider only mounts in preview mode, so
 * normal portal renders pay nothing).
 */
export function usePreviewDraft(): PortalPreviewDraft | null {
  return useContext(PreviewDraftContext)
}
