'use client'

import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { settingsQueries } from '@/lib/client/queries/settings'
import {
  createTeamFn,
  updateTeamFn,
  setTeamMembersFn,
  type TeamDTO,
} from '@/lib/server/functions/teams'
import { TEAM_ASSIGNMENT_METHODS, type TeamAssignmentMethod } from '@/lib/shared/db-types'
import { ColorSwatches, DEFAULT_TAG_COLOR } from '@/components/shared/color-swatches'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

const METHOD_LABELS: Record<TeamAssignmentMethod, string> = {
  manual: 'Manual (assign the team only)',
  round_robin: 'Round robin (rotate over online members)',
  balanced: 'Balanced (least busy online member)',
}

interface TeamDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The team being edited, or undefined to create a new one. */
  team?: TeamDTO
  /** The assignment method is the support facet; hidden when the inbox is off. */
  showAssignmentMethod?: boolean
}

export function TeamDialog({
  open,
  onOpenChange,
  team,
  showAssignmentMethod = true,
}: TeamDialogProps) {
  const queryClient = useQueryClient()
  const isEdit = !!team

  const [name, setName] = useState('')
  const [icon, setIcon] = useState('')
  const [color, setColor] = useState('')
  const [description, setDescription] = useState('')
  const [assignmentMethod, setAssignmentMethod] = useState<TeamAssignmentMethod>('manual')
  const [memberIds, setMemberIds] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)

  const teammatesQuery = useQuery({ ...settingsQueries.assignableTeammates(), enabled: open })
  const membersQuery = useQuery({
    ...settingsQueries.teamMembers(team?.id ?? ''),
    enabled: open && isEdit,
  })

  // Seed the form whenever the dialog opens (or the target team changes).
  useEffect(() => {
    if (!open) return
    setName(team?.name ?? '')
    setIcon(team?.icon ?? '')
    setColor(team?.color ?? '')
    setDescription(team?.description ?? '')
    setAssignmentMethod(team?.assignmentMethod ?? 'manual')
  }, [open, team])

  // Seed the membership set from the loaded members (edit only).
  useEffect(() => {
    if (open && isEdit && membersQuery.data) {
      setMemberIds(new Set(membersQuery.data.map((m) => m.principalId)))
    }
    if (open && !isEdit) setMemberIds(new Set())
  }, [open, isEdit, membersQuery.data])

  const toggleMember = (principalId: string) => {
    setMemberIds((prev) => {
      const next = new Set(prev)
      if (next.has(principalId)) next.delete(principalId)
      else next.add(principalId)
      return next
    })
  }

  const handleSave = async () => {
    const trimmed = name.trim()
    if (!trimmed) {
      toast.error('Team name is required')
      return
    }
    setSaving(true)
    try {
      const payload = {
        name: trimmed,
        icon: icon.trim() || null,
        color: color.trim() || null,
        description: description.trim() || null,
        // Preserve the stored method when the support facet is hidden.
        ...(showAssignmentMethod ? { assignmentMethod } : {}),
      }
      const saved = isEdit
        ? await updateTeamFn({ data: { id: team!.id, ...payload } })
        : await createTeamFn({ data: payload })
      // Only write membership when the set actually changed, so a name-only edit
      // skips the diff round trip.
      const original = new Set(membersQuery.data?.map((m) => m.principalId) ?? [])
      const sameMembers =
        memberIds.size === original.size && [...memberIds].every((id) => original.has(id))
      if (!sameMembers) {
        await setTeamMembersFn({ data: { teamId: saved.id, principalIds: [...memberIds] } })
      }
      await queryClient.invalidateQueries({ queryKey: ['settings', 'teams'] })
      toast.success(isEdit ? 'Team updated' : 'Team created')
      onOpenChange(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save team')
    } finally {
      setSaving(false)
    }
  }

  const teammates = teammatesQuery.data ?? []

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit team' : 'New team'}</DialogTitle>
          <DialogDescription>
            Teams group teammates so conversations can be assigned to a whole team.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-[1fr_auto] gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="team-name">Name</Label>
              <Input
                id="team-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Support"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="team-icon">Icon</Label>
              <Input
                id="team-icon"
                value={icon}
                onChange={(e) => setIcon(e.target.value)}
                placeholder="🎧"
                className="w-16 text-center"
                maxLength={4}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Color</Label>
            <ColorSwatches value={color || DEFAULT_TAG_COLOR} onChange={setColor} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="team-description">Description</Label>
            <Textarea
              id="team-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What this team handles"
              rows={2}
            />
          </div>

          {showAssignmentMethod && (
            <div className="space-y-1.5">
              <Label htmlFor="team-method">Assignment method</Label>
              <Select
                value={assignmentMethod}
                onValueChange={(v) => setAssignmentMethod(v as TeamAssignmentMethod)}
              >
                <SelectTrigger id="team-method">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TEAM_ASSIGNMENT_METHODS.map((m) => (
                    <SelectItem key={m} value={m}>
                      {METHOD_LABELS[m]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-1.5">
            <Label>Members</Label>
            <div className="max-h-52 overflow-y-auto rounded-md border border-border/50 divide-y divide-border/50">
              {teammates.length === 0 ? (
                <p className="p-3 text-sm text-muted-foreground">No teammates to add.</p>
              ) : (
                teammates.map((t) => (
                  <label
                    key={t.principalId}
                    className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-muted/40"
                  >
                    <Checkbox
                      checked={memberIds.has(t.principalId)}
                      onCheckedChange={() => toggleMember(t.principalId)}
                    />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium truncate">
                        {t.name ?? t.email ?? 'Unnamed'}
                      </span>
                      {t.email && (
                        <span className="block text-xs text-muted-foreground truncate">
                          {t.email}
                        </span>
                      )}
                    </span>
                  </label>
                ))
              )}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : isEdit ? 'Save changes' : 'Create team'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
