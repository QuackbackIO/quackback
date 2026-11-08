import { SettingsPage } from '@/components/admin/settings/settings-page'
import {
  WorkspaceEmailSettings,
  type SenderSurfaceKey,
} from '@/components/admin/channels/email-channel-settings'
import { EmailTransportCard } from '@/components/admin/channels/email-transport-card'
import { useFeatureFlags } from '@/lib/client/hooks/use-root-context'
import { isProductEnabled, type FeatureFlags } from '@/lib/shared/types'

/** The kinds of email that belong to a product; each has a row while it is on. */
const SURFACES: readonly SenderSurfaceKey[] = ['support', 'feedback', 'changelog', 'status']

/** The kinds of email with a row of their own: one per product that is on. */
export function senderSurfacesFor(
  flags: Partial<FeatureFlags> | null | undefined
): SenderSurfaceKey[] {
  return SURFACES.filter((surface) => isProductEnabled(flags, surface))
}

export function WorkspaceEmailPage() {
  const flags = useFeatureFlags()
  return (
    <SettingsPage
      page="/admin/settings/email"
      description="The addresses your email comes from, and which one each kind of email uses."
    >
      <WorkspaceEmailSettings surfaces={senderSurfacesFor(flags)} />
      <EmailTransportCard />
    </SettingsPage>
  )
}
