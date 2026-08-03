/**
 * SLA policy detail — Tabs shell with Overview / Targets / Escalations.
 */
import { Suspense } from 'react'
import { createFileRoute, Link, notFound } from '@tanstack/react-router'
import { createRouteErrorComponent } from '@/components/admin/shared'
import { useSuspenseQuery } from '@tanstack/react-query'
import type { SlaPolicyId } from '@quackback/ids'
import { slaQueries } from '@/lib/client/queries/sla'
import { businessHoursQueries } from '@/lib/client/queries/business-hours'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { ArrowLeftIcon } from '@heroicons/react/24/outline'
import { SlaPolicyOverviewTab } from '@/components/admin/settings/sla/sla-policy-overview-tab'
import { SlaTargetsTab } from '@/components/admin/settings/sla/sla-targets-tab'
import { SlaEscalationsTab } from '@/components/admin/settings/sla/sla-escalations-tab'

export const Route = createFileRoute('/admin/settings/sla_/$policyId')({
  loader: async ({ params, context }) => {
    const { queryClient } = context as {
      queryClient: import('@tanstack/react-query').QueryClient
    }
    const policyId = params.policyId as SlaPolicyId
    const [detail] = await Promise.all([
      queryClient.ensureQueryData(slaQueries.policy(policyId)),
      queryClient.ensureQueryData(slaQueries.escalations(policyId)),
      queryClient.ensureQueryData(businessHoursQueries.list({})),
    ])
    if (!detail) throw notFound()
  },
  errorComponent: createRouteErrorComponent('Failed to load SLA policy'),
  component: SlaPolicyDetailPage,
})

function SlaPolicyDetailPage() {
  const { policyId: rawId } = Route.useParams()
  const policyId = rawId as SlaPolicyId
  const { data: detail } = useSuspenseQuery(slaQueries.policy(policyId))

  if (!detail) return null
  const { policy, targets } = detail

  return (
    <div className="space-y-4 max-w-5xl">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="sm">
          <Link to="/admin/settings/sla">
            <ArrowLeftIcon className="h-4 w-4 mr-1" />
            SLA policies
          </Link>
        </Button>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-semibold">{policy.name}</h1>
            <Badge variant="outline" className="text-[10px]">
              {policy.scope}
            </Badge>
            {policy.archivedAt ? (
              <Badge variant="outline" className="text-muted-foreground">
                Archived
              </Badge>
            ) : (
              <Badge variant="outline">Active</Badge>
            )}
          </div>
          {policy.description && (
            <p className="text-xs text-muted-foreground mt-0.5">{policy.description}</p>
          )}
        </div>
      </div>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="targets">Targets</TabsTrigger>
          <TabsTrigger value="escalations">Escalations</TabsTrigger>
        </TabsList>
        <TabsContent value="overview" className="pt-4">
          <SlaPolicyOverviewTab policy={policy} />
        </TabsContent>
        <TabsContent value="targets" className="pt-4">
          <SlaTargetsTab policyId={policyId} initialTargets={targets} />
        </TabsContent>
        <TabsContent value="escalations" className="pt-4">
          <Suspense fallback={<Skeleton className="h-24 w-full" />}>
            <SlaEscalationsTab policyId={policyId} />
          </Suspense>
        </TabsContent>
      </Tabs>
    </div>
  )
}
