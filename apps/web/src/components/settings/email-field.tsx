import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import {
  getEmailChangeStateFn,
  sendCurrentAddressCodeFn,
  requestEmailChangeFn,
  confirmEmailChangeFn,
} from '@/lib/server/functions/contact-email'

type Step = 'idle' | 'current-code' | 'new-code' | 'done'

const message = (err: unknown, fallback: string) =>
  err instanceof Error && err.message ? err.message : fallback

/**
 * Set or change the account's email address.
 *
 * Two shapes, and which one you get is not a preference. An account whose
 * provider released no email has an undeliverable placeholder, so there is
 * nothing at the current address to protect and no one to notify — it is a
 * first-time SET, one code. An account with a real address is a CHANGE, and
 * proves the current address first so a stolen session cannot silently rebind
 * it.
 */
export function EmailField({ onChanged }: { onChanged?: () => void }) {
  const { data, refetch } = useQuery({
    queryKey: ['email-change-state'],
    queryFn: () => getEmailChangeStateFn(),
  })

  const [step, setStep] = useState<Step>('idle')
  const [newEmail, setNewEmail] = useState('')
  const [currentCode, setCurrentCode] = useState('')
  const [newCode, setNewCode] = useState('')
  const [busy, setBusy] = useState(false)

  const reset = () => {
    setStep('idle')
    setNewEmail('')
    setCurrentCode('')
    setNewCode('')
  }

  if (!data) {
    return (
      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input id="email" type="email" disabled placeholder="Loading…" />
      </div>
    )
  }

  const { currentEmail, requiresCurrentCode } = data

  // Starting the flow: for an account with a real address, the first code goes
  // to it. For a placeholder account there is nothing to send to, so the new
  // address is asked for straight away.
  const begin = async () => {
    if (!requiresCurrentCode) {
      setStep('new-code')
      return
    }
    setBusy(true)
    try {
      await sendCurrentAddressCodeFn()
      setStep('current-code')
    } catch (err) {
      toast.error(message(err, 'Could not send a code to your current address.'))
    } finally {
      setBusy(false)
    }
  }

  const sendToNewAddress = async () => {
    setBusy(true)
    try {
      await requestEmailChangeFn({
        data: { email: newEmail, ...(requiresCurrentCode ? { currentCode } : {}) },
      })
      setStep('new-code')
    } catch (err) {
      toast.error(message(err, 'Could not send a code to that address.'))
    } finally {
      setBusy(false)
    }
  }

  const confirm = async () => {
    setBusy(true)
    try {
      const res = await confirmEmailChangeFn({ data: { email: newEmail, code: newCode } })
      if (!res.ok) {
        toast.error('That code is not right, or the address is no longer available.')
        return
      }
      toast.success('Email updated.')
      reset()
      await refetch()
      onChanged?.()
    } catch (err) {
      toast.error(message(err, 'Could not confirm that code.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-2">
      <Label htmlFor="email">Email</Label>

      {step === 'idle' && (
        <>
          <div className="flex items-center gap-2">
            <Input
              id="email"
              type="email"
              value={currentEmail ?? ''}
              disabled
              placeholder="No email address"
            />
            <Button type="button" variant="outline" size="sm" onClick={begin} disabled={busy}>
              {currentEmail ? 'Change' : 'Add email'}
            </Button>
          </div>
          {!currentEmail && (
            <p className="text-xs text-muted-foreground">
              Your sign-in provider doesn&apos;t share an address, so we can&apos;t tell you when
              someone replies to you.
            </p>
          )}
        </>
      )}

      {step === 'current-code' && (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">
            We sent a code to {currentEmail}. Enter it, then tell us the new address.
          </p>
          <Input
            aria-label="Code sent to your current address"
            value={currentCode}
            onChange={(e) => setCurrentCode(e.target.value)}
            placeholder="6-digit code"
            disabled={busy}
          />
          <Input
            aria-label="New email address"
            type="email"
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            placeholder="New email address"
            disabled={busy}
          />
          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              onClick={sendToNewAddress}
              disabled={busy || !currentCode.trim() || !newEmail.trim()}
            >
              Send verification code
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={reset} disabled={busy}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {step === 'new-code' && (
        <div className="space-y-2">
          {!requiresCurrentCode && !newEmail && (
            <p className="text-sm text-muted-foreground">Enter your new email address.</p>
          )}
          <Input
            aria-label="New email address"
            type="email"
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            placeholder="New email address"
            disabled={busy}
          />
          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              onClick={sendToNewAddress}
              disabled={busy || !newEmail.trim()}
            >
              Send verification code
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={reset} disabled={busy}>
              Cancel
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            We&apos;ll send a code to that address. Enter it below once it arrives.
          </p>
          <Input
            aria-label="Code sent to the new address"
            value={newCode}
            onChange={(e) => setNewCode(e.target.value)}
            placeholder="6-digit code"
            disabled={busy}
          />
          <Button
            type="button"
            size="sm"
            onClick={confirm}
            disabled={busy || !newCode.trim() || !newEmail.trim()}
          >
            Confirm
          </Button>
        </div>
      )}
    </div>
  )
}
