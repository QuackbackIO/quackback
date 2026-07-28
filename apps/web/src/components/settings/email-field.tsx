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

/**
 * `address` is where the new address is named, with a proof of the current one
 * alongside it when there is a current one to prove — which `requiresCurrentCode`
 * already says, so it is not a second state.
 *
 * There is no way back from `verify` to the address field: the current-address
 * code is spent by the request that got us here, so changing the address means
 * starting over, which is what Cancel does.
 */
type Step = 'idle' | 'address' | 'verify'

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
export function EmailField() {
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
  /** Every action here is "disable the form, call one server fn, report". */
  const run = async (action: () => Promise<void>, fallback: string) => {
    setBusy(true)
    try {
      await action()
    } catch (err) {
      toast.error(message(err, fallback))
    } finally {
      setBusy(false)
    }
  }

  const begin = async () => {
    // A placeholder account has no reachable current address, so there is
    // nothing to send to and nothing to prove: go straight to naming one.
    if (!requiresCurrentCode) {
      setStep('address')
      return
    }
    await run(async () => {
      await sendCurrentAddressCodeFn()
      setStep('address')
    }, 'Could not send a code to your current address.')
  }

  const sendToNewAddress = () =>
    run(async () => {
      await requestEmailChangeFn({
        data: { email: newEmail, ...(requiresCurrentCode ? { currentCode } : {}) },
      })
      setStep('verify')
    }, 'Could not send a code to that address.')

  const confirm = () =>
    run(async () => {
      const res = await confirmEmailChangeFn({ data: { email: newEmail, code: newCode } })
      if (!res.ok) {
        toast.error('That code is not right, or the address is no longer available.')
        return
      }
      toast.success('Email updated.')
      reset()
      await refetch()
    }, 'Could not confirm that code.')

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

      {step === 'address' && (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">
            {requiresCurrentCode
              ? `We sent a code to ${currentEmail}. Enter it, then tell us the new address.`
              : 'Enter the address you want to use.'}
          </p>
          {requiresCurrentCode && (
            <Input
              aria-label="Code sent to your current address"
              value={currentCode}
              onChange={(e) => setCurrentCode(e.target.value)}
              placeholder="6-digit code"
              disabled={busy}
            />
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
              disabled={busy || !newEmail.trim() || (requiresCurrentCode && !currentCode.trim())}
            >
              Send verification code
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={reset} disabled={busy}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {step === 'verify' && (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">
            We sent a code to {newEmail}. Enter it to finish.
          </p>
          <Input
            aria-label="Code sent to the new address"
            value={newCode}
            onChange={(e) => setNewCode(e.target.value)}
            placeholder="6-digit code"
            disabled={busy}
          />
          <div className="flex items-center gap-2">
            <Button type="button" size="sm" onClick={confirm} disabled={busy || !newCode.trim()}>
              Confirm
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={reset} disabled={busy}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
