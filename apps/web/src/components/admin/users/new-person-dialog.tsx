/**
 * "New person" dialog — ad-hoc contact creation from the Users view.
 *
 * Cloned from NewCompanyDialog's conventions (companies-view.tsx). Email is
 * optional; the "Email is verified" checkbox asserts trust (it grants the
 * same portal access as a confirmed email) and is only enabled when an email
 * is entered.
 *
 * Dedup on submit: a VERIFIED user match blocks creation and links to the
 * existing person; unverified-user and lead matches (there can be several
 * leads per email) show as a soft "possible existing matches" list with view
 * links and a "create anyway" path.
 */
import { useState } from 'react'
import { useIntl } from 'react-intl'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ExclamationTriangleIcon } from '@heroicons/react/24/solid'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  createPortalUserFn,
  findPortalUsersByEmailFn,
  type ContactEmailMatch,
} from '@/lib/server/functions/admin'
import { usersKeys } from '@/lib/client/hooks/use-users-queries'

interface DedupState {
  /** The email the matches were fetched for; stale once the field changes. */
  email: string
  matches: ContactEmailMatch[]
}

export function NewPersonDialog({
  open,
  onOpenChange,
  onViewPerson,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Navigate to an existing or newly created person (principal id). */
  onViewPerson: (principalId: string) => void
}) {
  const intl = useIntl()
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [emailVerified, setEmailVerified] = useState(false)
  const [dedup, setDedup] = useState<DedupState | null>(null)
  const [isChecking, setIsChecking] = useState(false)

  const trimmedEmail = email.trim()
  const dedupIsCurrent = dedup !== null && dedup.email === trimmedEmail.toLowerCase()
  const verifiedMatch = dedupIsCurrent
    ? (dedup.matches.find((m) => m.type === 'verified_user') ?? null)
    : null
  const softMatches = dedupIsCurrent ? dedup.matches.filter((m) => m.type !== 'verified_user') : []

  const reset = () => {
    setName('')
    setEmail('')
    setEmailVerified(false)
    setDedup(null)
  }

  const create = useMutation({
    mutationFn: () =>
      createPortalUserFn({
        data: {
          name: name.trim(),
          email: trimmedEmail || undefined,
          emailVerified: trimmedEmail ? emailVerified : undefined,
        },
      }),
    onSuccess: async (person) => {
      await queryClient.invalidateQueries({ queryKey: usersKeys.lists() })
      onOpenChange(false)
      reset()
      onViewPerson(person.principalId)
    },
    onError: (error) => {
      toast.error(
        error instanceof Error && error.message
          ? error.message
          : intl.formatMessage({
              id: 'admin.people.new.createFailed',
              defaultMessage: 'Failed to create person',
            })
      )
    },
  })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim() || create.isPending || isChecking) return

    // No email -> nothing to dedup against.
    if (!trimmedEmail) {
      create.mutate()
      return
    }

    // First submit with this email: run the dedup check. A verified match
    // blocks; soft matches flip the button to "Create anyway".
    if (!dedupIsCurrent) {
      setIsChecking(true)
      try {
        const matches = await findPortalUsersByEmailFn({ data: { email: trimmedEmail } })
        setDedup({ email: trimmedEmail.toLowerCase(), matches })
        if (matches.length === 0) create.mutate()
      } catch {
        toast.error(
          intl.formatMessage({
            id: 'admin.people.new.checkFailed',
            defaultMessage: 'Could not check for existing people',
          })
        )
      } finally {
        setIsChecking(false)
      }
      return
    }

    // Dedup already ran for this email: verified match keeps blocking,
    // soft matches proceed as "create anyway".
    if (!verifiedMatch) create.mutate()
  }

  const matchTypeLabel = (type: ContactEmailMatch['type']) =>
    type === 'lead'
      ? intl.formatMessage({ id: 'admin.people.new.matchLead', defaultMessage: 'Lead' })
      : intl.formatMessage({
          id: 'admin.people.new.matchUnverifiedUser',
          defaultMessage: 'Unverified user',
        })

  const viewPerson = (principalId: string) => {
    onOpenChange(false)
    reset()
    onViewPerson(principalId)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next)
        if (!next) reset()
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {intl.formatMessage({ id: 'admin.people.new.title', defaultMessage: 'New person' })}
          </DialogTitle>
        </DialogHeader>
        <form className="space-y-4" onSubmit={handleSubmit}>
          <div className="space-y-1.5">
            <Label htmlFor="person-name">
              {intl.formatMessage({ id: 'admin.people.new.nameLabel', defaultMessage: 'Name' })}
            </Label>
            <Input
              id="person-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={intl.formatMessage({
                id: 'admin.people.new.namePlaceholder',
                defaultMessage: 'Jane Doe',
              })}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="person-email">
              {intl.formatMessage({ id: 'admin.people.new.emailLabel', defaultMessage: 'Email' })}{' '}
              <span className="text-muted-foreground font-normal">
                {intl.formatMessage({
                  id: 'admin.people.new.emailOptional',
                  defaultMessage: '(optional)',
                })}
              </span>
            </Label>
            <Input
              id="person-email"
              type="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value)
                if (!e.target.value.trim()) setEmailVerified(false)
              }}
              placeholder={intl.formatMessage({
                id: 'admin.people.new.emailPlaceholder',
                defaultMessage: 'jane@example.com',
              })}
            />
          </div>
          <div className="flex items-start gap-2">
            <Checkbox
              id="person-email-verified"
              checked={emailVerified}
              disabled={!trimmedEmail}
              onCheckedChange={(checked) => setEmailVerified(checked === true)}
              className="mt-0.5"
            />
            <div className="space-y-0.5">
              <Label
                htmlFor="person-email-verified"
                className={!trimmedEmail ? 'text-muted-foreground' : undefined}
              >
                {intl.formatMessage({
                  id: 'admin.people.new.verifiedLabel',
                  defaultMessage: 'Email is verified',
                })}
              </Label>
              <p className="text-xs text-muted-foreground">
                {intl.formatMessage({
                  id: 'admin.people.new.verifiedHelp',
                  defaultMessage:
                    'Grants the same portal access as a confirmed email. Only check this if you know the address belongs to this person.',
                })}
              </p>
            </div>
          </div>

          {verifiedMatch && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 space-y-2">
              <div className="flex items-center gap-2 text-sm font-medium">
                <ExclamationTriangleIcon className="size-4 text-destructive shrink-0" />
                {intl.formatMessage({
                  id: 'admin.people.new.verifiedMatch',
                  defaultMessage: 'A person with this email already exists.',
                })}
              </div>
              <div className="flex items-center justify-between gap-2 text-sm">
                <div className="min-w-0">
                  <div className="font-medium truncate">{verifiedMatch.name}</div>
                  <div className="text-xs text-muted-foreground truncate">
                    {verifiedMatch.email}
                  </div>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => viewPerson(verifiedMatch.principalId)}
                >
                  {intl.formatMessage({
                    id: 'admin.people.new.viewPerson',
                    defaultMessage: 'View person',
                  })}
                </Button>
              </div>
            </div>
          )}

          {!verifiedMatch && softMatches.length > 0 && (
            <div className="rounded-lg border border-border bg-muted/40 p-3 space-y-2">
              <div className="text-sm font-medium">
                {intl.formatMessage({
                  id: 'admin.people.new.possibleMatches',
                  defaultMessage: 'Possible existing matches',
                })}
              </div>
              <ul className="space-y-1.5">
                {softMatches.map((match) => (
                  <li
                    key={match.principalId}
                    className="flex items-center justify-between gap-2 text-sm"
                  >
                    <div className="min-w-0 flex items-center gap-1.5">
                      <span className="font-medium truncate">{match.name}</span>
                      <Badge size="sm" shape="pill" variant="secondary">
                        {matchTypeLabel(match.type)}
                      </Badge>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="text-muted-foreground shrink-0"
                      onClick={() => viewPerson(match.principalId)}
                    >
                      {intl.formatMessage({ id: 'admin.people.new.view', defaultMessage: 'View' })}
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={create.isPending}
            >
              {intl.formatMessage({ id: 'admin.people.new.cancel', defaultMessage: 'Cancel' })}
            </Button>
            <Button
              type="submit"
              disabled={!name.trim() || create.isPending || isChecking || !!verifiedMatch}
            >
              {create.isPending || isChecking
                ? intl.formatMessage({
                    id: 'admin.people.new.creating',
                    defaultMessage: 'Creating...',
                  })
                : softMatches.length > 0
                  ? intl.formatMessage({
                      id: 'admin.people.new.createAnyway',
                      defaultMessage: 'Create anyway',
                    })
                  : intl.formatMessage({
                      id: 'admin.people.new.create',
                      defaultMessage: 'Create person',
                    })}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
