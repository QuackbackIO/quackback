/**
 * Create-organization dialog. Navigates to detail on success.
 */
import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useRouter } from '@tanstack/react-router'
import { toast } from 'sonner'
import type { OrganizationId } from '@quackback/ids'
import { createOrganizationFn } from '@/lib/server/functions/organizations'
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

export function OrganizationCreateDialog({ trigger }: { trigger: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  const router = useRouter()
  const qc = useQueryClient()

  const [name, setName] = useState('')
  const [domain, setDomain] = useState('')
  const [website, setWebsite] = useState('')
  const [externalId, setExternalId] = useState('')
  const [notes, setNotes] = useState('')

  const reset = () => {
    setName('')
    setDomain('')
    setWebsite('')
    setExternalId('')
    setNotes('')
  }

  const mutation = useMutation({
    mutationFn: () =>
      createOrganizationFn({
        data: {
          name: name.trim(),
          domain: domain.trim() || null,
          website: website.trim() || null,
          externalId: externalId.trim() || null,
          notes: notes.trim() || null,
        },
      }),
    onSuccess: (org) => {
      qc.invalidateQueries({ queryKey: ['organizations'] })
      toast.success('Organization created')
      setOpen(false)
      reset()
      router.navigate({
        to: '/admin/contacts/organizations/$organizationId',
        params: { organizationId: org.id as OrganizationId },
      })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>New organization</DialogTitle>
          <DialogDescription>
            Companies, departments, or any account-level grouping.
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (!name.trim()) {
              toast.error('Name is required')
              return
            }
            mutation.mutate()
          }}
          className="space-y-3"
        >
          <div className="space-y-1">
            <Label htmlFor="org-name">Name</Label>
            <Input
              id="org-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              maxLength={200}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="org-domain">Domain</Label>
              <Input
                id="org-domain"
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
                maxLength={255}
                placeholder="acme.com"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="org-website">Website</Label>
              <Input
                id="org-website"
                value={website}
                onChange={(e) => setWebsite(e.target.value)}
                maxLength={500}
                placeholder="https://…"
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="org-external-id">External ID</Label>
            <Input
              id="org-external-id"
              value={externalId}
              onChange={(e) => setExternalId(e.target.value)}
              maxLength={255}
              className="font-mono text-xs"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="org-notes">Notes</Label>
            <Textarea
              id="org-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              maxLength={5000}
            />
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
              Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
