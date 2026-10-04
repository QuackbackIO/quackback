import { useState, type KeyboardEvent } from 'react'
import { FormattedMessage, useIntl } from 'react-intl'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { XMarkIcon } from '@heroicons/react/24/solid'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetTitle,
} from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { CopyButton } from '@/components/shared/copy-button'
import { adminQueries } from '@/lib/client/queries/admin'
import { sendInvitationFn } from '@/lib/server/functions/admin'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Split pasted or typed text into email candidates. */
export function parseInviteEmails(text: string): string[] {
  return text
    .split(/[\s,;]+/)
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean)
}

export function isInviteEmail(value: string): boolean {
  return EMAIL_RE.test(value)
}

type InviteRole = 'member' | 'admin'

interface InviteResult {
  email: string
  ok: boolean
  /** Only when the email could not be sent: the invitee's own link to share. */
  inviteLink?: string
  error?: string
}

export function InviteTeamSheet({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full gap-0 p-0 sm:max-w-[480px]">
        <header className="border-b px-5 py-4 pr-12">
          <SheetTitle>
            <FormattedMessage id="onboarding.live.invite.title" defaultMessage="Invite your team" />
          </SheetTitle>
          <SheetDescription className="sr-only">
            <FormattedMessage id="onboarding.live.invite.title" defaultMessage="Invite your team" />
          </SheetDescription>
        </header>
        {open && <InviteTeamBody onDone={() => onOpenChange(false)} />}
      </SheetContent>
    </Sheet>
  )
}

function InviteTeamBody({ onDone }: { onDone: () => void }) {
  const intl = useIntl()
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState('')
  const [emails, setEmails] = useState<string[]>([])
  const [role, setRole] = useState<InviteRole>('member')
  const [results, setResults] = useState<InviteResult[]>([])

  const addFrom = (text: string) => {
    const next = parseInviteEmails(text)
    if (next.length === 0) return
    setEmails((prev) => [...new Set([...prev, ...next])])
    setDraft('')
  }
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (['Enter', ',', ' ', 'Tab'].includes(event.key) && draft.trim()) {
      event.preventDefault()
      addFrom(draft)
    } else if (event.key === 'Backspace' && !draft && emails.length > 0) {
      setEmails((prev) => prev.slice(0, -1))
    }
  }

  const invite = useMutation({
    mutationFn: async (list: string[]): Promise<InviteResult[]> => {
      const out: InviteResult[] = []
      for (const email of list) {
        try {
          const result = await sendInvitationFn({ data: { email, role } })
          out.push({ email, ok: true, inviteLink: result.inviteLink })
        } catch (error) {
          out.push({ email, ok: false, error: error instanceof Error ? error.message : undefined })
        }
      }
      return out
    },
    onSuccess: (out) => {
      setResults(out)
      setEmails(out.filter((r) => !r.ok).map((r) => r.email))
      void queryClient.invalidateQueries({ queryKey: adminQueries.onboardingStatus().queryKey })
      void queryClient.invalidateQueries({ queryKey: ['admin', 'team'] })
    },
  })

  const pending = [...emails, ...(draft.trim() ? parseInviteEmails(draft) : [])]
  const invalid = pending.filter((email) => !isInviteEmail(email))
  const sent = results.filter((r) => r.ok)

  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-5">
        <div className="space-y-2">
          <label htmlFor="invite-emails" className="text-sm font-medium">
            <FormattedMessage id="onboarding.live.invite.emails" defaultMessage="Email addresses" />
          </label>
          <div className="flex min-h-10 flex-wrap items-center gap-1.5 rounded-md border px-2 py-1.5 focus-within:ring-2 focus-within:ring-ring/40">
            {emails.map((email) => (
              <span
                key={email}
                data-testid="invite-chip"
                className={
                  isInviteEmail(email)
                    ? 'inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs'
                    : 'inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-0.5 text-xs text-destructive'
                }
              >
                {email}
                <button
                  type="button"
                  className="rounded-full text-muted-foreground hover:text-foreground"
                  onClick={() => setEmails((prev) => prev.filter((e) => e !== email))}
                  aria-label={intl.formatMessage(
                    { id: 'onboarding.live.invite.remove', defaultMessage: 'Remove {email}' },
                    { email }
                  )}
                >
                  <XMarkIcon className="size-3" />
                </button>
              </span>
            ))}
            <Input
              id="invite-emails"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={onKeyDown}
              onBlur={() => addFrom(draft)}
              onPaste={(event) => {
                event.preventDefault()
                addFrom(event.clipboardData.getData('text'))
              }}
              placeholder={
                emails.length
                  ? ''
                  : intl.formatMessage({
                      id: 'onboarding.live.invite.placeholder',
                      defaultMessage: 'name@company.com',
                    })
              }
              className="h-7 min-w-[10rem] flex-1 border-0 px-1 shadow-none focus-visible:ring-0"
            />
          </div>
        </div>

        <div className="space-y-2">
          <span className="text-sm font-medium">
            <FormattedMessage id="onboarding.live.invite.role" defaultMessage="Role" />
          </span>
          <Select value={role} onValueChange={(value) => setRole(value as InviteRole)}>
            <SelectTrigger className="w-40" aria-label="Role">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="member">
                <FormattedMessage id="onboarding.live.invite.member" defaultMessage="Member" />
              </SelectItem>
              <SelectItem value="admin">
                <FormattedMessage id="onboarding.live.invite.admin" defaultMessage="Admin" />
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        {results.length > 0 && (
          <ul className="space-y-2 text-sm" data-testid="invite-results">
            {results.map((r) => (
              <li key={r.email} className="space-y-1">
                <span className={r.ok ? 'text-foreground' : 'text-destructive'}>
                  {r.ok ? (
                    <FormattedMessage
                      id="onboarding.live.invite.sentTo"
                      defaultMessage="Invited {email}"
                      values={{ email: r.email }}
                    />
                  ) : (
                    (r.error ?? r.email)
                  )}
                </span>
                {r.inviteLink && (
                  <div className="flex items-center gap-2 rounded-md border bg-muted/50 px-2 py-1">
                    <code className="min-w-0 flex-1 truncate text-xs">{r.inviteLink}</code>
                    <CopyButton value={r.inviteLink} variant="ghost" size="sm" />
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
      <SheetFooter className="flex-row justify-end gap-2 border-t p-4">
        {sent.length > 0 && (
          <Button variant="outline" onClick={onDone}>
            <FormattedMessage id="onboarding.live.install.done" defaultMessage="Done" />
          </Button>
        )}
        <Button
          disabled={pending.length === 0 || invalid.length > 0 || invite.isPending}
          onClick={() => invite.mutate(pending)}
        >
          <FormattedMessage id="onboarding.live.invite.send" defaultMessage="Send invites" />
        </Button>
      </SheetFooter>
    </>
  )
}
