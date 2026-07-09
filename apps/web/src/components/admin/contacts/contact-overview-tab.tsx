/**
 * Editable contact form. Bottom Archive section. No unarchive (backend does
 * not expose unarchiveContactFn).
 */
import { useState, useEffect } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import type { Contact } from '@/lib/shared/db-types'
import type { OrganizationId } from '@quackback/ids'
import { updateContactFn, archiveContactFn } from '@/lib/server/functions/contacts'
import { contactQueries } from '@/lib/client/queries/contacts'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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
import { OrgPicker } from '@/components/admin/shared/org-picker'
import { PermissionGate } from '@/components/admin/shared/permission-gate'
import { PERMISSIONS } from '@/lib/server/domains/authz'

export function ContactOverviewTab({ contact }: { contact: Contact }) {
  const qc = useQueryClient()
  const [name, setName] = useState(contact.name ?? '')
  const [email, setEmail] = useState(contact.email ?? '')
  const [phone, setPhone] = useState(contact.phone ?? '')
  const [title, setTitle] = useState(contact.title ?? '')
  const [externalId, setExternalId] = useState(contact.externalId ?? '')
  const [organizationId, setOrganizationId] = useState<OrganizationId | null>(
    (contact.organizationId as OrganizationId | null) ?? null
  )

  useEffect(() => {
    setName(contact.name ?? '')
    setEmail(contact.email ?? '')
    setPhone(contact.phone ?? '')
    setTitle(contact.title ?? '')
    setExternalId(contact.externalId ?? '')
    setOrganizationId((contact.organizationId as OrganizationId | null) ?? null)
  }, [contact])

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: contactQueries.detail(contact.id).queryKey })
    qc.invalidateQueries({ queryKey: ['contacts'] })
  }

  const saveMutation = useMutation({
    mutationFn: () =>
      updateContactFn({
        data: {
          contactId: contact.id,
          name: name.trim() || null,
          email: email.trim() || null,
          phone: phone.trim() || null,
          title: title.trim() || null,
          externalId: externalId.trim() || null,
          organizationId: organizationId ?? null,
        },
      }),
    onSuccess: () => {
      invalidate()
      toast.success('Contact updated')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const archiveMutation = useMutation({
    mutationFn: () => archiveContactFn({ data: { contactId: contact.id } }),
    onSuccess: () => {
      invalidate()
      toast.success('Contact archived')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  return (
    <div className="space-y-6 max-w-2xl">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (!name.trim() && !email.trim()) {
            toast.error('Name or email is required')
            return
          }
          saveMutation.mutate()
        }}
        className="space-y-3"
      >
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label htmlFor="contact-name">Name</Label>
            <Input
              id="contact-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={200}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="contact-email">Email</Label>
            <Input
              id="contact-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              maxLength={320}
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label htmlFor="contact-phone">Phone</Label>
            <Input
              id="contact-phone"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              maxLength={64}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="contact-title">Title</Label>
            <Input
              id="contact-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={120}
            />
          </div>
        </div>
        <div className="space-y-1">
          <Label>Organization</Label>
          <OrgPicker value={organizationId} onValueChange={setOrganizationId} allowClear />
        </div>
        <div className="space-y-1">
          <Label htmlFor="contact-external-id">External ID</Label>
          <Input
            id="contact-external-id"
            value={externalId}
            onChange={(e) => setExternalId(e.target.value)}
            maxLength={255}
            className="font-mono text-xs"
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
        {contact.archivedAt ? (
          <div className="rounded-md border border-border/50 p-4 space-y-2">
            <div className="text-sm font-medium">Archived</div>
            <p className="text-xs text-muted-foreground">
              This contact is archived. Restoring is not currently supported.
            </p>
          </div>
        ) : (
          <div className="rounded-md border border-border/50 p-4 space-y-2">
            <div className="text-sm font-medium">Archive</div>
            <p className="text-xs text-muted-foreground">
              Archived contacts are hidden from pickers; existing tickets keep their reference.
            </p>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" size="sm">
                  Archive
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Archive contact?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This action cannot be undone from the UI.
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
          </div>
        )}
      </PermissionGate>
    </div>
  )
}
