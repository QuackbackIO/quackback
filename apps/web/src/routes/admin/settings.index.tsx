'use client'

import { useEffect } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { SettingsNav } from '@/components/admin/settings/settings-nav'
import { Cog6ToothIcon } from '@heroicons/react/24/solid'
import { useMediaQuery } from '@/lib/client/hooks/use-media-query'

export const Route = createFileRoute('/admin/settings/')({
  component: SettingsIndexPage,
})

function SettingsIndexPage() {
  const navigate = useNavigate()
  const isDesktop = useMediaQuery('(min-width: 1024px)')

  // On desktop, redirect to team settings since the sidebar handles navigation
  useEffect(() => {
    if (isDesktop) {
      navigate({ to: '/admin/settings/team', replace: true })
    }
  }, [isDesktop, navigate])

  return (
    <div className="lg:hidden">
      <div className="flex items-center gap-3 mb-6">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
          <Cog6ToothIcon className="h-5 w-5 text-primary" />
        </div>
        <h1 className="text-xl font-semibold text-foreground">Settings</h1>
      </div>
      <SettingsNav />
    </div>
  )
}
