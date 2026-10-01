'use client'

import { useEffect } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { SettingsNav } from '@/components/admin/settings/settings-nav'
import { SettingsPage } from '@/components/admin/settings/settings-page'
import { useMediaQuery } from '@/lib/client/hooks/use-media-query'
import {
  useBillingEnabled,
  useCloudEnabled,
  useFeatureFlags,
} from '@/lib/client/hooks/use-root-context'
import { usePermissions } from '@/lib/client/use-permissions'
import {
  buildNavSections,
  firstSettingsPath,
} from '@/components/admin/settings/settings-nav-sections'

export const Route = createFileRoute('/admin/settings/')({
  component: SettingsIndexPage,
})

function SettingsIndexPage() {
  const navigate = useNavigate()
  const isDesktop = useMediaQuery('(min-width: 1024px)')
  const flags = useFeatureFlags()
  const billingEnabled = useBillingEnabled()
  const cloudEnabled = useCloudEnabled()
  const permissions = usePermissions()

  // On desktop the sidebar handles navigation, so open the first page this
  // viewer may open (General for anyone who holds settings.manage).
  useEffect(() => {
    if (isDesktop) {
      const to = firstSettingsPath(
        buildNavSections(flags, billingEnabled, cloudEnabled),
        permissions
      )
      navigate({ to, replace: true })
    }
  }, [isDesktop, navigate, flags, billingEnabled, cloudEnabled, permissions])

  return (
    <div className="lg:hidden">
      <SettingsPage title="Settings" backLink={false}>
        <SettingsNav />
      </SettingsPage>
    </div>
  )
}
