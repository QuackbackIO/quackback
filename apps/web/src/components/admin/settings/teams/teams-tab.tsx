import { useState } from 'react'
import { useSuspenseQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { UserGroupIcon } from '@heroicons/react/24/solid'
import { settingsQueries } from '@/lib/client/queries/settings'
import { deleteTeamFn, type TeamDTO } from '@/lib/server/functions/teams'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import { SettingsList, SettingsListRow } from '@/components/admin/settings/settings-list'
import { NewButton } from '@/components/shared/new-button'
import { EmptyState } from '@/components/shared/empty-state'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import { TeamDialog } from '@/components/admin/settings/teams/team-dialog'
import type { FeatureFlags } from '@/lib/shared/types'
import { useWorkspaceSettings } from '@/lib/client/hooks/use-root-context'

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
  const settings = useWorkspaceSettings()
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
      <SettingsCard
        title="Teams"
        description="Group teammates into named teams."
        action={teams.length > 0 ? <NewButton noun="team" onClick={openCreate} /> : undefined}
        flush
      >
        {teams.length === 0 ? (
          <EmptyState
            size="compact"
            icon={UserGroupIcon}
            title="No teams yet"
            description="Group teammates so work can be assigned to a team."
            action={<NewButton noun="team" onClick={openCreate} />}
          />
        ) : (
          <SettingsList>
            {teams.map((team) => (
              <SettingsListRow
                key={team.id}
                leading={
                  <div
                    className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-base"
                    style={{ backgroundColor: team.color ? `${team.color}22` : undefined }}
                  >
                    {team.icon || <UserGroupIcon className="size-4 text-muted-foreground" />}
                  </div>
                }
                title={team.name}
                meta={[
                  `${team.memberCount} ${team.memberCount === 1 ? 'member' : 'members'}`,
                  showAssignmentMethod
                    ? (METHOD_LABELS[team.assignmentMethod] ?? team.assignmentMethod)
                    : null,
                  team.description || null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
                actions={[
                  { label: 'Edit', onSelect: () => openEdit(team) },
                  {
                    label: 'Delete',
                    destructive: true,
                    disabled: team.isDefault,
                    hint: team.isDefault ? 'The default team cannot be deleted' : undefined,
                    onSelect: () => setDeleting(team),
                  },
                ]}
              />
            ))}
          </SettingsList>
        )}
      </SettingsCard>

      <TeamDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        team={editing}
        showAssignmentMethod={showAssignmentMethod}
      />

      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Delete team?"
        description={
          deleting
            ? `Delete "${deleting.name}"? Conversations assigned to it will become team-unassigned.`
            : ''
        }
        variant="destructive"
        confirmLabel="Delete team"
        isPending={deletePending}
        onConfirm={handleDelete}
      />
    </div>
  )
}
