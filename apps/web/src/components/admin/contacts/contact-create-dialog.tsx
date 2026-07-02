/**
 * Create-contact dialog. Optional `defaultOrganizationId` prop pre-selects the
 * org picker (used from the org-detail Contacts tab).
 */
import { useState, useEffect } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useRouter } from '@tanstack/react-router'
import { toast } from 'sonner'
import type { ContactId, OrganizationId } from '@quackback/ids'
import { createContactFn } from '@/lib/server/functions/contacts'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { OrgPicker } from '@/components/admin/shared/org-picker'

interface Props {
  trigger: React.ReactNode
  defaultOrganizationId?: OrganizationId
}

export function ContactCreateDialog({ trigger, defaultOrganizationId }: Props) {
  const [open, setOpen] = useState(false)
  const router = useRouter()
  const qc = useQueryClient()

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [title, setTitle] = useState('')
  const [externalId, setExternalId] = useState('')
  const [organizationId, setOrganizationId] = useState<OrganizationId | null>(
    defaultOrganizationId ?? null
  )

  useEffect(() => {
    if (open) setOrganizationId(defaultOrganizationId ?? null)
  }, [open, defaultOrganizationId])

  const reset = () => {
    setName('')
    setEmail('')
    setPhone('')
    setTitle('')
    setExternalId('')
    setOrganizationId(defaultOrganizationId ?? null)
  }

  const mutation = useMutation({
    mutationFn: () =>
      createContactFn({
        data: {
          name: name.trim() || null,
          email: email.trim() || null,
          phone: phone.trim() || null,
          title: title.trim() || null,
          externalId: externalId.trim() || null,
          organizationId: organizationId ?? null,
        },
      }),
    onSuccess: (contact) => {
      qc.invalidateQueries({ queryKey: ['contacts'] })
      toast.success('Contact created')
      setOpen(false)
      reset()
      router.navigate({
        to: '/admin/contacts/people/$contactId',
        params: { contactId: contact.id as ContactId },
      })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>New contact</DialogTitle>
          <DialogDescription>
            People you support — typically a customer or end-user representative.
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (!name.trim() && !email.trim()) {
              toast.error('Name or email is required')
              return
            }
            mutation.mutate()
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
