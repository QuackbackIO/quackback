/**
 * Add a sending address, or rename one: its email address (on add) and the
 * sender name its mail goes out under, which starts as the workspace name.
 */
import { useState } from 'react'
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
} from '@/components/ui/dialog'
import {
  useCreateSendingAddress,
  useUpdateSendingAddressName,
} from '@/lib/client/mutations/channel-accounts'

/** What the dialog is open for: a new address, or renaming one. */
export type SendingAddressDialogTarget =
  { kind: 'add' } | { kind: 'rename'; id: string; address: string; senderName: string | null }

/** The name as stored: the workspace name, or a blank one, is null. */
const storedName = (typed: string, workspaceName: string): string | null => {
  const name = typed.trim()
  return name && name !== workspaceName ? name : null
}

/** The server's sentence for a failed action, or the generic line. */
export const errorText = (error: unknown, fallback: string): string =>
  error instanceof Error && error.message ? error.message : fallback

export function SendingAddressDialog({
  target,
  workspaceName,
  onClose,
}: {
  target: SendingAddressDialogTarget | null
  workspaceName: string
  onClose: () => void
}) {
  return (
    <Dialog open={!!target} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        {target ? (
          <SendingAddressForm
            key={target.kind === 'rename' ? target.id : 'add'}
            target={target}
            workspaceName={workspaceName}
            onClose={onClose}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

function SendingAddressForm({
  target,
  workspaceName,
  onClose,
}: {
  target: SendingAddressDialogTarget
  workspaceName: string
  onClose: () => void
}) {
  const create = useCreateSendingAddress()
  const rename = useUpdateSendingAddressName()
  const [address, setAddress] = useState('')
  const [senderName, setSenderName] = useState(
    target.kind === 'rename' ? (target.senderName ?? workspaceName) : workspaceName
  )
  // Inline rather than a toast: these failures name a fix (verify a domain
  // first, the plan's limit), and a toast is gone before it is read.
  const [error, setError] = useState<string | null>(null)
  const pending = create.isPending || rename.isPending
  const adding = target.kind === 'add'

  const submit = () => {
    setError(null)
    const name = storedName(senderName, workspaceName)
    if (target.kind === 'add') {
      create.mutate(
        { address: address.trim(), senderName: name },
        { onSuccess: onClose, onError: (e) => setError(errorText(e, "Couldn't add the address.")) }
      )
    } else {
      rename.mutate(
        { id: target.id, senderName: name },
        { onSuccess: onClose, onError: (e) => setError(errorText(e, "Couldn't save the name.")) }
      )
    }
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
    >
      <DialogHeader>
        <DialogTitle>{adding ? 'Add address' : 'Edit name'}</DialogTitle>
        <DialogDescription>
          {adding
            ? 'Email can be sent from it once its domain is verified.'
            : `The name email from ${target.address} is sent under.`}
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-3 py-4">
        {adding && (
          <div className="space-y-1.5">
            <Label htmlFor="sending-address">Email address</Label>
            <Input
              id="sending-address"
              type="email"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="help@yourcompany.com"
              autoFocus
            />
          </div>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="sender-name">Sender name</Label>
          <Input
            id="sender-name"
            value={senderName}
            onChange={(e) => setSenderName(e.target.value)}
            placeholder={workspaceName}
            maxLength={100}
          />
        </div>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </div>
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending || (adding && !address.trim())}>
          {adding ? 'Add address' : 'Save'}
        </Button>
      </DialogFooter>
    </form>
  )
}
