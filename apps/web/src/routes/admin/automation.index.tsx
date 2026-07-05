'use client'

import { useEffect } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { SparklesIcon } from '@heroicons/react/24/solid'
import { AutomationNav } from '@/components/admin/automation/automation-nav'
import { PageHeader } from '@/components/shared/page-header'
import { useMediaQuery } from '@/lib/client/hooks/use-media-query'

export const Route = createFileRoute('/admin/automation/')({
  component: AutomationIndexPage,
})

function AutomationIndexPage() {
  const navigate = useNavigate()
  const isDesktop = useMediaQuery('(min-width: 1024px)')

  // On desktop, redirect to Assistant since the sidebar handles navigation.
  useEffect(() => {
    if (isDesktop) {
      navigate({ to: '/admin/automation/assistant', replace: true })
    }
  }, [isDesktop, navigate])

  return (
    <div className="lg:hidden">
      <PageHeader icon={SparklesIcon} title="AI & Automation" className="mb-6" />
      <AutomationNav />
    </div>
  )
}
