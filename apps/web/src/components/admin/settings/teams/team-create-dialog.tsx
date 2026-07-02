/**
 * Create-team dialog. slug + name + optional description/shortLabel/color.
 * On success navigates to the team detail page.
 */
import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useRouter } from '@tanstack/react-router'
import { toast } from 'sonner'
import type { TeamId } from '@quackback/ids'
import { createTeamFn } from '@/lib/server/functions/teams'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'

const SLUG_RE = /^[a-z0-9-]+$/

export function TeamCreateDialog({ trigger }: { trigger: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  const router = useRouter()
  const qc = useQueryClient()

  const [slug, setSlug] = useState('')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [shortLabel, setShortLabel] = useState('')
  const [color, setColor] = useState('')

  const reset = () => {
    setSlug('')
    setName('')
    setDescription('')
    setShortLabel('')
    setColor('')
  }

  const mutation = useMutation({
    mutationFn: () =>
      createTeamFn({
        data: {
          slug: slug.trim(),
          name: name.trim(),
          description: description.trim() || null,
          shortLabel: shortLabel.trim() || null,
          color: color.trim() || null,
        },
      }),
    onSuccess: (team) => {
      qc.invalidateQueries({ queryKey: ['teams'] })
      toast.success('Team created')
      setOpen(false)
      reset()
      router.navigate({
        to: '/admin/settings/teams/$teamId',
        params: { teamId: team.id as TeamId },
      })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>New team</DialogTitle>
          <DialogDescription>
            Workspace teams group agents for routing, sharing, and SLA scopes.
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={(e) => {
            e.preventDefault()
            const slugTrim = slug.trim()
            if (!slugTrim || !name.trim()) {
              toast.error('Slug and name are required')
              return
            }
            if (!SLUG_RE.test(slugTrim)) {
              toast.error('Slug must be lowercase letters, numbers, or hyphens')
              return
            }
            mutation.mutate()
          }}
          className="space-y-3"
        >
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="team-slug">Slug</Label>
              <Input
                id="team-slug"
                value={slug}
                onChange={(e) => setSlug(e.target.value.toLowerCase())}
                placeholder="tier-1"
                required
                maxLength={64}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="team-name">Name</Label>
              <Input
                id="team-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Tier 1 support"
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
                placeholder="T1"
                maxLength={8}
              />
              <p className="text-[11px] text-muted-foreground">Up to 8 chars. Optional.</p>
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

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={mutation.isPending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              Create team
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
