import { createServerFn } from '@tanstack/react-start'
import { requireAuth, policyActorFromAuth } from './auth-helpers'
import {
  ensureAutomaticWebsiteBranding,
  getAutomaticWebsiteBrandingStatus,
  undoAutomaticWebsiteBranding,
} from '@/lib/server/domains/assistant/automatic-website-branding.service'

export const startAutomaticWebsiteBrandingFn = createServerFn({ method: 'POST' }).handler(
  async () => {
    const actor = await policyActorFromAuth(await requireAuth())
    return ensureAutomaticWebsiteBranding(actor)
  }
)
export const getAutomaticWebsiteBrandingStatusFn = createServerFn({ method: 'GET' }).handler(
  async () => {
    const actor = await policyActorFromAuth(await requireAuth())
    return getAutomaticWebsiteBrandingStatus(actor)
  }
)
export const undoAutomaticWebsiteBrandingFn = createServerFn({ method: 'POST' }).handler(
  async () => {
    const actor = await policyActorFromAuth(await requireAuth())
    return undoAutomaticWebsiteBranding(actor)
  }
)
