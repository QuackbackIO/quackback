import { useState } from 'react'
import { useIntl } from 'react-intl'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  useRefreshConnector,
  useUpdateConnector,
} from '@/lib/client/mutations/assistant-connectors'

export function UpdateBearerDialog({
  connectorId,
  open,
  onOpenChange,
}: {
  connectorId: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const intl = useIntl()
  const update = useUpdateConnector()
  const refresh = useRefreshConnector()
  const [token, setToken] = useState('')

  const close = () => {
    setToken('')
    onOpenChange(false)
  }

  const submit = () => {
    if (!connectorId || !token.trim()) return
    update.mutate(
      { id: connectorId, bearerToken: token.trim() },
      {
        onSuccess: () => {
          refresh.mutate(connectorId, {
            onError: () => toast.error('Could not refresh tools'),
          })
          toast.success(
            intl.formatMessage({
              id: 'automation.connectors.tokenUpdated',
              defaultMessage: 'Token updated',
            })
          )
          close()
        },
        onError: () => toast.error('Could not update the token'),
      }
    )
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {intl.formatMessage({
              id: 'automation.connectors.updateToken',
              defaultMessage: 'Update token',
            })}
          </DialogTitle>
          <DialogDescription>
            {intl.formatMessage({
              id: 'automation.connectors.updateTokenHint',
              defaultMessage: 'Paste a new bearer token and reconnect to the server.',
            })}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="connector-bearer-token">
            {intl.formatMessage({
              id: 'automation.connectors.fields.token',
              defaultMessage: 'Bearer token',
            })}
          </Label>
          <Input
            id="connector-bearer-token"
            type="password"
            autoComplete="off"
            value={token}
            onChange={(e) => setToken(e.target.value)}
          />
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={close}>
            {intl.formatMessage({ id: 'common.cancel', defaultMessage: 'Cancel' })}
          </Button>
          <Button type="button" onClick={submit} disabled={!token.trim() || update.isPending}>
            {intl.formatMessage({
              id: 'automation.connectors.updateToken',
              defaultMessage: 'Update token',
            })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
