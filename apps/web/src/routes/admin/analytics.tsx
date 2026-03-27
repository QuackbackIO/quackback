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
    <div className="flex flex-col gap-6 p-6 animate-pulse">
      <div className="flex items-center justify-between">
        <div className="h-8 w-32 rounded bg-muted" />
        <div className="flex gap-2">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-9 w-20 rounded-md bg-muted" />
          ))}
        </div>
      </div>
      <div className="grid grid-cols-4 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-28 rounded-lg bg-muted" />
        ))}
      </div>
      <div className="h-72 rounded-lg bg-muted" />
      <div className="grid grid-cols-2 gap-4">
        <div className="h-56 rounded-lg bg-muted" />
        <div className="h-56 rounded-lg bg-muted" />
      </div>
    </div>
  )
}
