import { createFileRoute, Navigate } from '@tanstack/react-router'
import { Suspense } from 'react'
import { AnalyticsPage } from '@/components/admin/analytics/analytics-page'
import type { FeatureFlags } from '@/lib/server/domains/settings/settings.types'

export const Route = createFileRoute('/admin/analytics')({
  component: AnalyticsRoute,
})

function AnalyticsRoute() {
  const { settings } = Route.useRouteContext()
  const flags = settings?.featureFlags as FeatureFlags | undefined
  if (!flags?.analytics) {
    return <Navigate to="/admin/feedback" />
  }

  return (
    <Suspense fallback={<AnalyticsPageSkeleton />}>
      <AnalyticsPage />
    </Suspense>
  )
}

function AnalyticsPageSkeleton() {
  return (
    <div className="flex h-full">
      <div className="hidden lg:block w-64 xl:w-72 shrink-0 border-r border-border/50 bg-card/30" />
      <div className="flex-1 p-6 flex flex-col gap-6 animate-pulse">
        <div className="grid grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-28 rounded-xl bg-muted" />
          ))}
        </div>
        <div className="h-72 rounded-xl bg-muted" />
      </div>
    </div>
  )
}
