import { useState } from 'react'
import { useIntl } from 'react-intl'
import { useNavigate } from '@tanstack/react-router'
import { toast } from 'sonner'
import { ChevronDownIcon } from '@heroicons/react/24/outline'
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
import { useCreateConnector } from '@/lib/client/mutations/assistant-connectors'
import {
  connectorCreateInputSchema,
  type ConnectorAuthMode,
} from '@/lib/shared/assistant/connectors'

export function AddConnectorDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const intl = useIntl()
  const navigate = useNavigate()
  const create = useCreateConnector()
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [authMode, setAuthMode] = useState<ConnectorAuthMode>('oauth')
  const [bearerToken, setBearerToken] = useState('')
  const [advanced, setAdvanced] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reset = () => {
    setName('')
    setUrl('')
    setAuthMode('oauth')
    setBearerToken('')
    setAdvanced(false)
    setError(null)
  }

  const submit = () => {
    const parsed = connectorCreateInputSchema.safeParse({
      name,
      url,
      authMode,
      bearerToken: authMode === 'bearer' ? bearerToken : undefined,
      assignments: { agent: true, copilot: true },
    })
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Invalid connector')
      return
    }
    setError(null)
    create.mutate(parsed.data, {
      onSuccess: (row) => {
        if (row.authorizationUrl) {
          window.location.assign(row.authorizationUrl)
          return
        }
        toast.success(
          intl.formatMessage({
            id: 'automation.connectors.created',
            defaultMessage: 'Connector added',
          })
        )
        onOpenChange(false)
        reset()
        void navigate({
          to: '/admin/automation/connectors/$connectorId',
          params: { connectorId: row.id },
        })
      },
      onError: (err) => {
        setError(err instanceof Error ? err.message : 'Could not connect')
      },
    })
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset()
        onOpenChange(next)
      }}
    >
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {intl.formatMessage({
              id: 'automation.connectors.add.title',
              defaultMessage: 'Add connector',
            })}
          </DialogTitle>
          <DialogDescription>
            {intl.formatMessage({
              id: 'automation.connectors.add.description',
              defaultMessage:
                'Connect Quinn to an external MCP server. Tools are discovered automatically.',
            })}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="connector-name">
              {intl.formatMessage({
                id: 'automation.connectors.fields.name',
                defaultMessage: 'Name',
              })}
            </Label>
            <Input id="connector-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="connector-url">
              {intl.formatMessage({
                id: 'automation.connectors.fields.url',
                defaultMessage: 'Remote MCP server URL',
              })}
            </Label>
            <Input
              id="connector-url"
              className="font-mono text-[13px]"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://"
            />
            <p className="text-xs text-muted-foreground">
              {intl.formatMessage({
                id: 'automation.connectors.fields.urlHint',
                defaultMessage: 'The HTTPS address where the server accepts MCP requests.',
              })}
            </p>
          </div>
          <button
            type="button"
            className="inline-flex items-center gap-1.5 text-[13px] font-medium text-muted-foreground hover:text-foreground"
            onClick={() => setAdvanced((value) => !value)}
          >
            <ChevronDownIcon
              className={`size-3.5 transition-transform ${advanced ? '' : '-rotate-90'}`}
            />
            {intl.formatMessage({
              id: 'automation.connectors.add.advanced',
              defaultMessage: 'Advanced · Authentication',
            })}
          </button>
          {advanced && (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2">
                {(['oauth', 'bearer', 'none'] as const).map((mode) => (
                  <Button
                    key={mode}
                    type="button"
                    size="sm"
                    variant={authMode === mode ? 'default' : 'outline'}
                    onClick={() => setAuthMode(mode)}
                  >
                    {mode === 'oauth'
                      ? intl.formatMessage({
                          id: 'automation.connectors.auth.oauth',
                          defaultMessage: 'OAuth (automatic)',
                        })
                      : mode === 'bearer'
                        ? intl.formatMessage({
                            id: 'automation.connectors.auth.bearer',
                            defaultMessage: 'Bearer token',
                          })
                        : intl.formatMessage({
                            id: 'automation.connectors.auth.none',
                            defaultMessage: 'None',
                          })}
                  </Button>
                ))}
              </div>
              <p className="text-[11.5px] text-muted-foreground">
                {intl.formatMessage({
                  id: 'automation.connectors.auth.oauthHint',
                  defaultMessage:
                    'OAuth is negotiated with the server on connect. Pick Bearer token for servers that use a static API key.',
                })}
              </p>
              {authMode === 'bearer' && (
                <Input
                  type="password"
                  value={bearerToken}
                  onChange={(e) => setBearerToken(e.target.value)}
                  placeholder={intl.formatMessage({
                    id: 'automation.connectors.fields.token',
                    defaultMessage: 'Bearer token',
                  })}
                />
              )}
            </div>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {intl.formatMessage({ id: 'common.cancel', defaultMessage: 'Cancel' })}
          </Button>
          <Button type="button" onClick={submit} disabled={create.isPending}>
            {intl.formatMessage({
              id: 'automation.connectors.add.submit',
              defaultMessage: 'Connect',
            })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
