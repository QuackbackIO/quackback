/**
 * Add a web address on a domain: a name typed in front of the domain, and
 * what the address opens. What it opens is fixed by the server for now (the
 * whole portal on Cloud, the help center on a self-hosted server).
 */
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { opensLabel, type WebAddressOpens } from '@/lib/shared/web-addresses'

/** Dot-separated labels of letters, numbers and inner hyphens; empty means the domain itself. */
const PREFIX = /^([a-z0-9]([a-z0-9-]*[a-z0-9])?)(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/

function opensLine(opens: WebAddressOpens): string {
  if (opens === 'portal') return 'Opens your whole portal.'
  if (opens === 'help') return 'Opens your help center.'
  return `Opens ${opensLabel(opens)}.`
}

/** The address a typed prefix makes on the domain, or null when it is not a name. */
export function webAddressOn(prefix: string, domain: string): string | null {
  const clean = prefix.trim().toLowerCase().replace(/\.+$/, '')
  if (!clean) return domain
  return PREFIX.test(clean) ? `${clean}.${domain}` : null
}

export interface AddWebAddressTarget {
  /** The name filled in to start with. */
  prefix: string
}

export function AddWebAddressDialog({
  target,
  domain,
  opens,
  busy,
  onAdd,
  onClose,
}: {
  target: AddWebAddressTarget | null
  domain: string
  opens: WebAddressOpens
  busy: boolean
  onAdd: (hostname: string) => void
  onClose: () => void
}) {
  return (
    <Dialog open={target !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add a web address</DialogTitle>
        </DialogHeader>
        {target && (
          <AddWebAddressForm
            key={target.prefix}
            start={target.prefix}
            domain={domain}
            opens={opens}
            busy={busy}
            onAdd={onAdd}
            onCancel={onClose}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

function AddWebAddressForm({
  start,
  domain,
  opens,
  busy,
  onAdd,
  onCancel,
}: {
  start: string
  domain: string
  opens: WebAddressOpens
  busy: boolean
  onAdd: (hostname: string) => void
  onCancel: () => void
}) {
  const [prefix, setPrefix] = useState(start)
  const [error, setError] = useState<string | null>(null)
  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const hostname = webAddressOn(prefix, domain)
    if (!hostname) {
      setError('Use letters, numbers and hyphens, like help or status.')
      return
    }
    onAdd(hostname)
  }
  return (
    <form onSubmit={submit}>
      <div className="space-y-2 py-4">
        <Label htmlFor="web-address-prefix">Address</Label>
        <div className="flex h-9 items-center border border-input bg-transparent shadow-xs transition-[color,box-shadow] outline-none focus-within:border-ring focus-within:ring-ring/50 focus-within:ring-[3px] dark:bg-input/30 [border-radius:calc(var(--radius)*0.8)]">
          <Input
            id="web-address-prefix"
            value={prefix}
            onChange={(e) => {
              setPrefix(e.target.value)
              setError(null)
            }}
            className="h-full min-w-0 border-0 focus-visible:ring-0"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            disabled={busy}
            autoFocus
          />
          <span className="shrink-0 pe-3 text-sm text-muted-foreground">.{domain}</span>
        </div>
        <p className="text-[13px] text-muted-foreground">{opensLine(opens)}</p>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button type="submit" disabled={busy}>
          Add
        </Button>
      </DialogFooter>
    </form>
  )
}
