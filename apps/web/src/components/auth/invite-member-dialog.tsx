import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { standardSchemaResolver } from '@hookform/resolvers/standard-schema'
import { CheckCircle2 } from 'lucide-react'
import { inviteSchema, type InviteInput } from '@/lib/schemas/auth'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
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
import { sendInvitationFn } from '@/lib/server-functions/admin'

interface InviteMemberDialogProps {
  open: boolean
  onClose: () => void
}

export function InviteMemberDialog({ open, onClose }: InviteMemberDialogProps) {
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)

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
      await sendInvitationFn({
        data: {
          email: data.email,
          name: data.name || undefined,
          role: data.role,
        },
      })

      setSuccess(true)
      form.reset()
      setTimeout(() => {
        setSuccess(false)
        onClose()
      }, 2000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send invitation')
    }
  }

  function handleOpenChange(isOpen: boolean) {
    if (!isOpen) {
      form.reset()
      setError('')
      setSuccess(false)
      onClose()
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite Team Member</DialogTitle>
        </DialogHeader>

        {success ? (
          <div className="py-8 flex flex-col items-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 mb-4">
              <CheckCircle2 className="h-6 w-6 text-primary" />
            </div>
            <div className="text-lg font-semibold text-foreground">Invitation sent!</div>
            <p className="mt-2 text-sm text-muted-foreground text-center">
              {form.getValues('email')} will receive an email with instructions to join.
            </p>
          </div>
        ) : (
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              {error && (
                <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                  {error}
                </div>
              )}

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
