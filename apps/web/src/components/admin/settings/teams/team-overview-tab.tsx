/**
 * Overview tab for a team detail page. Editable form for name/description/
 * shortLabel/color plus an Archive / Unarchive section. Slug is read-only
 * because `updateTeamFn` does not accept it.
 */
import { useState, useEffect } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import type { Team } from '@/lib/shared/db-types'
import { updateTeamFn, archiveTeamFn, unarchiveTeamFn } from '@/lib/server/functions/teams'
import { teamQueries } from '@/lib/client/queries/teams'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { PermissionGate } from '@/components/admin/shared/permission-gate'
import { PERMISSIONS } from '@/lib/server/domains/authz'

export function TeamOverviewTab({ team }: { team: Team }) {
  const qc = useQueryClient()
  const [name, setName] = useState(team.name)
  const [description, setDescription] = useState(team.description ?? '')
  const [shortLabel, setShortLabel] = useState(team.shortLabel ?? '')
  const [color, setColor] = useState(team.color ?? '')

  useEffect(() => {
    setName(team.name)
    setDescription(team.description ?? '')
    setShortLabel(team.shortLabel ?? '')
    setColor(team.color ?? '')
  }, [team])

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: teamQueries.detail(team.id).queryKey })
    qc.invalidateQueries({ queryKey: ['teams'] })
  }

  const saveMutation = useMutation({
    mutationFn: () =>
      updateTeamFn({
        data: {
          teamId: team.id,
          name: name.trim(),
          description: description.trim() || null,
          shortLabel: shortLabel.trim() || null,
          color: color.trim() || null,
        },
      }),
    onSuccess: () => {
      invalidate()
      toast.success('Team updated')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const archiveMutation = useMutation({
    mutationFn: () => archiveTeamFn({ data: { teamId: team.id } }),
    onSuccess: () => {
      invalidate()
      toast.success('Team archived')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const unarchiveMutation = useMutation({
    mutationFn: () => unarchiveTeamFn({ data: { teamId: team.id } }),
    onSuccess: () => {
      invalidate()
      toast.success('Team unarchived')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  return (
    <div className="space-y-6 max-w-2xl">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (!name.trim()) {
            toast.error('Name is required')
            return
          }
          saveMutation.mutate()
        }}
        className="space-y-3"
      >
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label>Slug</Label>
            <Input value={team.slug} disabled readOnly className="font-mono text-xs" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="team-name">Name</Label>
            <Input
              id="team-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              maxLength={120}
            />
          </div>
        </div>

        <div className="space-y-1">
          <Label htmlFor="team-description">Description</Label>
          <Textarea
            id="team-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            maxLength={500}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label htmlFor="team-short-label">Short label</Label>
            <Input
              id="team-short-label"
              value={shortLabel}
              onChange={(e) => setShortLabel(e.target.value)}
              maxLength={8}
              placeholder="T1"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="team-color">Color</Label>
            <div className="flex items-center gap-2">
              <Input
                id="team-color"
                type="color"
                value={color || '#6366f1'}
                onChange={(e) => setColor(e.target.value)}
                className="h-9 w-12 p-1"
              />
              <Input
                value={color}
                onChange={(e) => setColor(e.target.value)}
                placeholder="#6366f1"
                maxLength={16}
                className="font-mono text-xs"
              />
            </div>
          </div>
        </div>

        <PermissionGate permission={PERMISSIONS.ADMIN_MANAGE_USERS}>
          <div className="flex justify-end">
            <Button type="submit" disabled={saveMutation.isPending}>
              Save changes
            </Button>
          </div>
        </PermissionGate>
      </form>

      <PermissionGate permission={PERMISSIONS.ADMIN_MANAGE_USERS}>
        <div className="rounded-md border border-border/50 p-4 space-y-2">
          <div className="text-sm font-medium">Archive</div>
          <p className="text-xs text-muted-foreground">
            Archived teams are hidden from pickers but historical references remain intact.
          </p>
          {team.archivedAt ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => unarchiveMutation.mutate()}
              disabled={unarchiveMutation.isPending}
            >
              Unarchive team
            </Button>
          ) : (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" size="sm">
                  Archive team
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Archive {team.name}?</AlertDialogTitle>
                  <AlertDialogDescription>
                    The team will be hidden from pickers. You can unarchive it later.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={() => archiveMutation.mutate()}>
                    Archive
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>
      </PermissionGate>
    </div>
  )
}
