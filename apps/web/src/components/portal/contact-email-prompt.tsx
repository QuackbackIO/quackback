import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { realEmail } from '@/lib/shared/anonymous-email'
import {
  getContactEmailStatusFn,
  requestContactEmailFn,
} from '@/lib/server/functions/contact-email'

/** Remembered per browser so declining is not re-asked on every page load. */
const DISMISSED_KEY = 'qb.contact-email.dismissed'

function dismissed(): boolean {
  try {
    return localStorage.getItem(DISMISSED_KEY) === '1'
  } catch {
    // Private mode or blocked storage. Better to ask again than to crash.
    return false
  }
}

/**
 * Asks for a reachable address when the identity provider released none.
 *
 * Someone signing in through such a provider gets a minted placeholder, so
 * their account works but nothing can reach them. The account is already
 * created and the session already exists by the time this renders, which is
 * exactly why declining has to leave a completely working account rather than a
 * half-finished signup.
 *
 * Costs nothing for everyone else: the account address is already in the
 * session, so whether it is a placeholder is decided on the client, and only
 * the affected population asks the server anything.
 */
export function ContactEmailPrompt({
  accountEmail,
  isAuthenticated,
}: {
  accountEmail: string | null | undefined
  isAuthenticated: boolean
}) {
  const needsAddress = isAuthenticated && !realEmail(accountEmail)

  const { data } = useQuery({
    queryKey: ['contact-email-status'],
    queryFn: () => getContactEmailStatusFn(),
    enabled: needsAddress,
    staleTime: 5 * 60 * 1000,
  })

  const [open, setOpen] = useState(true)
  const [email, setEmail] = useState('')
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)

  if (!needsAddress || !data || data.hasContactEmail || dismissed()) return null

  const decline = () => {
    try {
      localStorage.setItem(DISMISSED_KEY, '1')
    } catch {
      // Nothing to do; they will be asked again next visit.
    }
    setOpen(false)
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSending(true)
    try {
      await requestContactEmailFn({ data: { email } })
      setSent(true)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not send the confirmation.')
    } finally {
      setSending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? setOpen(true) : decline())}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{sent ? 'Check your email' : 'Add an email so we can reply'}</DialogTitle>
        </DialogHeader>

        {sent ? (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              We sent a confirmation to {email}. Open the link and we&rsquo;ll start sending your
              notifications there.
            </p>
            <Button type="button" className="w-full" onClick={() => setOpen(false)}>
              Done
            </Button>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Your account works either way. Without an address we can&rsquo;t tell you when someone
              answers your post.
            </p>
            <div className="space-y-2">
              <Label htmlFor="contact-email">Email address</Label>
              <Input
                id="contact-email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(ev) => setEmail(ev.target.value)}
                placeholder="you@example.com"
                disabled={sending}
              />
              <p className="text-xs text-muted-foreground">
                We&rsquo;ll send one message to confirm it. Used for notifications only.
              </p>
            </div>
            <div className="flex items-center justify-between gap-2">
              <Button type="button" variant="ghost" onClick={decline} disabled={sending}>
                Not now
              </Button>
              <Button type="submit" disabled={sending || email.trim().length === 0}>
                {sending ? 'Sending…' : 'Send confirmation'}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
