import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { standardSchemaResolver } from '@hookform/resolvers/standard-schema'
import { CheckCircleIcon, CheckIcon, ClipboardDocumentIcon } from '@heroicons/react/24/solid'
import { inviteSchema, type InviteInput } from '@/lib/shared/schemas/auth'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { FormError } from '@/components/shared/form-error'
import { useCopyToClipboard } from '@/lib/client/hooks/use-copy-to-clipboard'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { sendInvitationFn } from '@/lib/server/functions/admin'

function InviteLinkView({
  inviteLink,
  email,
  onClose,
}: {
  inviteLink: string
  email: string
  onClose: () => void
}) {
  const { copied, copy } = useCopyToClipboard()

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Email delivery is not configured. Copy the invitation link below and share it with{' '}
        <span className="font-medium text-foreground">{email}</span>.
      </p>

      <div className="rounded-lg border bg-muted/50 p-3">
        <code className="block break-all font-mono text-xs text-muted-foreground leading-relaxed">
          {inviteLink}
        </code>
      </div>

      <div className="flex gap-2">
        <Button className="flex-1" onClick={() => copy(inviteLink)}>
          {copied ? (
            <>
              <CheckIcon className="h-4 w-4" />
              Copied!
            </>
          ) : (
            <>
              <ClipboardDocumentIcon className="h-4 w-4" />
              Copy invitation link
            </>
          )}
        </Button>
        <Button variant="outline" onClick={onClose}>
          Done
        </Button>
      </div>
    </div>
  )
}

interface InviteMemberDialogProps {
  open: boolean
  onClose: () => void
  onSuccess?: () => void
}

export function InviteMemberDialog({ open, onClose, onSuccess }: InviteMemberDialogProps) {
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const [inviteLink, setInviteLink] = useState<string | null>(null)

  const form = useForm<InviteInput>({
    resolver: standardSchemaResolver(inviteSchema),
    defaultValues: {
      email: '',
      name: '',
      role: 'member',
    },
  })

  async function onSubmit(data: InviteInput) {
    setError('')

    try {
      const result = await sendInvitationFn({ data })

      setSuccess(true)
      onSuccess?.()

      if (result.emailSent === false && result.inviteLink) {
        setInviteLink(result.inviteLink)
      } else {
        form.reset()
        setTimeout(() => {
          setSuccess(false)
          onClose()
        }, 2000)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send invitation')
    }
  }

  function handleOpenChange(isOpen: boolean) {
    if (!isOpen) {
      form.reset()
      setError('')
      setSuccess(false)
      setInviteLink(null)
      onClose()
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Invite Team Member</DialogTitle>
        </DialogHeader>

        {success ? (
          inviteLink ? (
            <InviteLinkView
              inviteLink={inviteLink}
              email={form.getValues('email')}
              onClose={() => handleOpenChange(false)}
            />
          ) : (
            <div className="py-8 flex flex-col items-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 mb-4">
                <CheckCircleIcon className="h-6 w-6 text-primary" />
              </div>
              <div className="text-lg font-semibold text-foreground">Invitation sent!</div>
              <p className="mt-2 text-sm text-muted-foreground text-center">
                {form.getValues('email')} will receive an email with instructions to join.
              </p>
            </div>
          )
        ) : (
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              {error && <FormError message={error} />}

              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Name</FormLabel>
                    <FormControl>
                      <Input
                        type="text"
                        placeholder="John Doe"
                        {...field}
                        value={field.value ?? ''}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email Address</FormLabel>
                    <FormControl>
                      <Input type="email" placeholder="colleague@example.com" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="role"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Role</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="member">
                          Member - Can view and create feedback
                        </SelectItem>
                        <SelectItem value="admin">
                          Admin - Can manage settings and members
                        </SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <DialogFooter>
                <Button type="button" variant="outline" onClick={onClose}>
                  Cancel
                </Button>
                <Button type="submit" disabled={form.formState.isSubmitting}>
                  {form.formState.isSubmitting ? 'Sending...' : 'Send Invitation'}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        )}
      </DialogContent>
    </Dialog>
  )
}
