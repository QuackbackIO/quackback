'use client'

import { useEffect } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { SettingsNav } from '@/components/admin/settings/settings-nav'
import { PageHeader } from '@/components/shared/page-header'
import { Cog6ToothIcon } from '@heroicons/react/24/solid'
import { useMediaQuery } from '@/lib/client/hooks/use-media-query'

export const Route = createFileRoute('/admin/settings/')({
  component: SettingsIndexPage,
})

function SettingsIndexPage() {
  const navigate = useNavigate()
  const isDesktop = useMediaQuery('(min-width: 1024px)')

  // On desktop, redirect to General since the sidebar handles navigation
  useEffect(() => {
    if (isDesktop) {
      navigate({ to: '/admin/settings/general', replace: true })
    }
  }, [isDesktop, navigate])

  return (
    <div className="lg:hidden">
      <PageHeader icon={Cog6ToothIcon} title="Settings" className="mb-6" />
      <SettingsNav />
    </div>
  )
}
