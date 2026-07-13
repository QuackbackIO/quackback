/**
 * Editable overview form for an organization. Bottom Archive/Unarchive section.
 */
import { useState, useEffect } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import type { Organization } from '@/lib/shared/db-types'
import {
  updateOrganizationFn,
  archiveOrganizationFn,
  unarchiveOrganizationFn,
} from '@/lib/server/functions/organizations'
import { organizationQueries } from '@/lib/client/queries/organizations'
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

export function OrganizationOverviewTab({ organization }: { organization: Organization }) {
  const qc = useQueryClient()
  const [name, setName] = useState(organization.name)
  const [domain, setDomain] = useState(organization.domain ?? '')
  const [website, setWebsite] = useState(organization.website ?? '')
  const [externalId, setExternalId] = useState(organization.externalId ?? '')
  const [notes, setNotes] = useState(organization.notes ?? '')

  useEffect(() => {
    setName(organization.name)
    setDomain(organization.domain ?? '')
    setWebsite(organization.website ?? '')
    setExternalId(organization.externalId ?? '')
    setNotes(organization.notes ?? '')
  }, [organization])

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: organizationQueries.detail(organization.id).queryKey })
    qc.invalidateQueries({ queryKey: ['organizations'] })
  }

  const saveMutation = useMutation({
    mutationFn: () =>
      updateOrganizationFn({
        data: {
          organizationId: organization.id,
          name: name.trim(),
          domain: domain.trim() || null,
          website: website.trim() || null,
          externalId: externalId.trim() || null,
          notes: notes.trim() || null,
        },
      }),
    onSuccess: () => {
      invalidate()
      toast.success('Organization updated')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const archiveMutation = useMutation({
    mutationFn: () => archiveOrganizationFn({ data: { organizationId: organization.id } }),
    onSuccess: () => {
      invalidate()
      toast.success('Organization archived')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const unarchiveMutation = useMutation({
    mutationFn: () => unarchiveOrganizationFn({ data: { organizationId: organization.id } }),
    onSuccess: () => {
      invalidate()
      toast.success('Organization unarchived')
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
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="org-website">Website</Label>
            <Input
              id="org-website"
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
              maxLength={500}
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
            rows={4}
            maxLength={5000}
          />
        </div>

        <PermissionGate permission={PERMISSIONS.ORG_MANAGE}>
          <div className="flex justify-end">
            <Button type="submit" disabled={saveMutation.isPending}>
              Save changes
            </Button>
          </div>
        </PermissionGate>
      </form>

      <PermissionGate permission={PERMISSIONS.ORG_MANAGE}>
        <div className="rounded-md border border-border/50 p-4 space-y-2">
          <div className="text-sm font-medium">Archive</div>
          <p className="text-xs text-muted-foreground">
            Archived organizations are hidden from pickers; existing tickets keep their reference.
          </p>
          {organization.archivedAt ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => unarchiveMutation.mutate()}
              disabled={unarchiveMutation.isPending}
            >
              Unarchive
            </Button>
          ) : (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" size="sm">
                  Archive
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Archive {organization.name}?</AlertDialogTitle>
                  <AlertDialogDescription>
                    The organization will be hidden from pickers. You can unarchive it later.
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
