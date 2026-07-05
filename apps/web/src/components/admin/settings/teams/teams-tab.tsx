import { useState } from 'react'
import { useRouteContext } from '@tanstack/react-router'
import { useSuspenseQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { UserGroupIcon, PencilSquareIcon, TrashIcon, PlusIcon } from '@heroicons/react/24/solid'
import { settingsQueries } from '@/lib/client/queries/settings'
import { deleteTeamFn, type TeamDTO } from '@/lib/server/functions/teams'
import { PageHeader } from '@/components/shared/page-header'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import { TeamDialog } from '@/components/admin/settings/teams/team-dialog'
import type { FeatureFlags } from '@/lib/shared/types'

const METHOD_LABELS: Record<string, string> = {
  manual: 'Manual',
  round_robin: 'Round robin',
  balanced: 'Balanced',
}

/** Named teammate groups (the Teams tab of Members & Teams). Teams are the
 *  workspace org-unit; the assignment method is the support facet and only
 *  shows when the support inbox is enabled. */
export function TeamsTab() {
  const queryClient = useQueryClient()
  const { settings } = useRouteContext({ from: '__root__' })
  const flags = settings?.featureFlags as FeatureFlags | undefined
  const showAssignmentMethod = !!flags?.supportInbox

  const teamsQuery = useSuspenseQuery(settingsQueries.teams())
  const teams = teamsQuery.data

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<TeamDTO | undefined>(undefined)
  const [deleting, setDeleting] = useState<TeamDTO | null>(null)
  const [deletePending, setDeletePending] = useState(false)

  const openCreate = () => {
    setEditing(undefined)
    setDialogOpen(true)
  }
  const openEdit = (team: TeamDTO) => {
    setEditing(team)
    setDialogOpen(true)
  }

  const handleDelete = async () => {
    if (!deleting) return
    setDeletePending(true)
    try {
      await deleteTeamFn({ data: { id: deleting.id } })
      await queryClient.invalidateQueries({ queryKey: ['settings', 'teams'] })
      toast.success('Team deleted')
      setDeleting(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete team')
    } finally {
      setDeletePending(false)
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        icon={UserGroupIcon}
        title="Teams"
        description="Group teammates into named teams"
        action={
          <Button onClick={openCreate}>
            <PlusIcon className="h-4 w-4" />
            New team
          </Button>
        }
      />

      <div className="rounded-xl border border-border/50 bg-card shadow-sm divide-y divide-border/50">
        {teams.length === 0 ? (
          <p className="h-24 flex items-center justify-center text-muted-foreground text-sm">
            No teams yet
          </p>
        ) : (
          teams.map((team) => (
            <div key={team.id} className="flex items-center gap-3 p-4">
              <div
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-lg"
                style={{ backgroundColor: team.color ? `${team.color}22` : undefined }}
              >
                {team.icon || <UserGroupIcon className="h-4 w-4 text-muted-foreground" />}
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-medium text-foreground truncate">
                  {team.name}
                  {team.isDefault && (
                    <Badge variant="outline" className="ml-2 bg-muted/50">
                      Default
                    </Badge>
                  )}
                </p>
                <p className="text-xs text-muted-foreground truncate">
                  {team.memberCount} {team.memberCount === 1 ? 'member' : 'members'}
                  {showAssignmentMethod && (
                    <>
                      <span className="mx-1">&middot;</span>
                      {METHOD_LABELS[team.assignmentMethod] ?? team.assignmentMethod}
                    </>
                  )}
                  {team.description ? (
                    <>
                      <span className="mx-1">&middot;</span>
                      {team.description}
                    </>
                  ) : null}
                </p>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => openEdit(team)}
                  aria-label="Edit team"
                >
                  <PencilSquareIcon className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setDeleting(team)}
                  disabled={team.isDefault}
                  aria-label="Delete team"
                  title={team.isDefault ? 'The default team cannot be deleted' : 'Delete team'}
                >
                  <TrashIcon className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))
        )}
      </div>

      <TeamDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        team={editing}
        showAssignmentMethod={showAssignmentMethod}
      />

      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Delete team"
        description={
          deleting
            ? `Delete "${deleting.name}"? Conversations assigned to it will become team-unassigned.`
            : ''
        }
        variant="destructive"
        confirmLabel="Delete"
        isPending={deletePending}
        onConfirm={handleDelete}
      />
    </div>
  )
}
