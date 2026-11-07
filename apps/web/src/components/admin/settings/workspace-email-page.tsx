import { SettingsPage } from '@/components/admin/settings/settings-page'
import {
  WorkspaceEmailSettings,
  type SenderSurfaceKey,
} from '@/components/admin/channels/email-channel-settings'
import { EmailTransportCard } from '@/components/admin/channels/email-transport-card'
import { useFeatureFlags } from '@/lib/client/hooks/use-root-context'
import { isProductEnabled, type FeatureFlags } from '@/lib/shared/types'

/** The product whose email each sender row covers. */
const SURFACE_PRODUCT = {
  support: 'support',
  feedback: 'feedback',
  changelog: 'changelog',
  status: 'status',
} as const satisfies Record<SenderSurfaceKey, Parameters<typeof isProductEnabled>[1]>

/** The kinds of email with a row of their own: one per product that is on. */
export function senderSurfacesFor(
  flags: Partial<FeatureFlags> | null | undefined
): SenderSurfaceKey[] {
  return (Object.keys(SURFACE_PRODUCT) as SenderSurfaceKey[]).filter((surface) =>
    isProductEnabled(flags, SURFACE_PRODUCT[surface])
  )
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
