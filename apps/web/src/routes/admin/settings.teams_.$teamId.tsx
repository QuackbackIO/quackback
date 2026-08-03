/**
 * Team detail route — Tabs shell with Overview / Members.
 */
import { Suspense } from 'react'
import { createFileRoute, Link, notFound } from '@tanstack/react-router'
import { createRouteErrorComponent } from '@/components/admin/shared'
import { useSuspenseQuery } from '@tanstack/react-query'
import type { TeamId } from '@quackback/ids'
import { teamQueries } from '@/lib/client/queries/teams'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { ArrowLeftIcon } from '@heroicons/react/24/outline'
import { TeamOverviewTab } from '@/components/admin/settings/teams/team-overview-tab'
import { TeamMembersTab } from '@/components/admin/settings/teams/team-members-tab'

export const Route = createFileRoute('/admin/settings/teams_/$teamId')({
  loader: async ({ params, context }) => {
    const { queryClient } = context as {
      queryClient: import('@tanstack/react-query').QueryClient
    }
    const teamId = params.teamId as TeamId
    const [detail] = await Promise.all([
      queryClient.ensureQueryData(teamQueries.detail(teamId)),
      queryClient.ensureQueryData(teamQueries.members(teamId)),
    ])
    if (!detail) throw notFound()
  },
  errorComponent: createRouteErrorComponent('Failed to load team'),
  component: TeamDetailPage,
})

function TeamDetailPage() {
  const { teamId: rawId } = Route.useParams()
  const teamId = rawId as TeamId
  const { data: team } = useSuspenseQuery(teamQueries.detail(teamId))

  if (!team) return null

  return (
    <div className="space-y-4 max-w-5xl">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="sm">
          <Link to="/admin/settings/teams">
            <ArrowLeftIcon className="h-4 w-4 mr-1" />
            Teams
          </Link>
        </Button>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-semibold">{team.name}</h1>
            <span className="font-mono text-xs text-muted-foreground">{team.slug}</span>
            {team.shortLabel && (
              <span
                className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium"
                style={{
                  backgroundColor: team.color ?? 'var(--muted)',
                  color: team.color ? '#fff' : undefined,
                }}
              >
                {team.shortLabel}
              </span>
            )}
            {team.archivedAt ? (
              <Badge variant="outline" className="text-muted-foreground">
                Archived
              </Badge>
            ) : (
              <Badge variant="outline">Active</Badge>
            )}
          </div>
          {team.description && (
            <p className="text-xs text-muted-foreground mt-0.5">{team.description}</p>
          )}
        </div>
      </div>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="members">Members</TabsTrigger>
        </TabsList>
        <TabsContent value="overview" className="pt-4">
          <TeamOverviewTab team={team} />
        </TabsContent>
        <TabsContent value="members" className="pt-4">
          <Suspense fallback={<Skeleton className="h-24 w-full" />}>
            <TeamMembersTab teamId={teamId} />
          </Suspense>
        </TabsContent>
      </Tabs>
    </div>
  )
}
