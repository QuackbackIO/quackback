'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Checkbox } from '@/components/ui/checkbox'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ConnectorHeadersEditor } from './connector-headers-editor'
import { ConnectorInputsEditor } from './connector-inputs-editor'
import { TestConnectorPanel } from './test-connector-panel'
import { useCreateConnector, useUpdateConnector } from '@/lib/client/mutations/connectors'
import type {
  ConnectorAuthType,
  ConnectorHeader,
  ConnectorInputField,
  ConnectorMethod,
  DataConnector,
} from '@/lib/server/domains/connectors/connector.types'

const AUTH_TYPES: { value: ConnectorAuthType; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'bearer', label: 'Bearer token' },
  { value: 'header', label: 'Custom header' },
  { value: 'basic', label: 'Basic auth' },
]

const BUILTIN_TOKENS = ['{customer.email}', '{customer.name}', '{conversation.id}']

const DEFAULT_TIMEOUT_MS = 10000

interface ConnectorFormDialogProps {
  /** Existing connector to edit, or null to create a new one. */
  connector: DataConnector | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * Create/edit form for a data connector. The secret is write-only: an
 * existing one never comes back from the server, so editing shows a blank
 * field with a "leave blank to keep" placeholder, plus an explicit way to
 * clear it. Testing a connector needs a persisted row (the test-call fn
 * executes the saved configuration), so the test panel only appears once
 * editing an already-saved connector.
 */
export function ConnectorFormDialog({ connector, open, onOpenChange }: ConnectorFormDialogProps) {
  const create = useCreateConnector()
  const update = useUpdateConnector()
  const saving = create.isPending || update.isPending

  const [name, setName] = useState(connector?.name ?? '')
  const [description, setDescription] = useState(connector?.description ?? '')
  const [method, setMethod] = useState<ConnectorMethod>(connector?.method ?? 'GET')
  const [urlTemplate, setUrlTemplate] = useState(connector?.urlTemplate ?? '')
  const [headers, setHeaders] = useState<ConnectorHeader[]>(connector?.headers ?? [])
  const [authType, setAuthType] = useState<ConnectorAuthType>(connector?.auth?.type ?? 'none')
  const [authHeaderName, setAuthHeaderName] = useState(connector?.auth?.headerName ?? '')
  const [secretDraft, setSecretDraft] = useState('')
  const [clearSecret, setClearSecret] = useState(false)
  const [inputs, setInputs] = useState<ConnectorInputField[]>(connector?.inputs ?? [])
  const [bodyTemplate, setBodyTemplate] = useState(connector?.bodyTemplate ?? '')
  const [timeoutMs, setTimeoutMs] = useState(connector?.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  const [enabled, setEnabled] = useState(connector?.enabled ?? false)
  const [error, setError] = useState<string | null>(null)

  const templateTokens = [
    ...inputs.filter((input) => input.name.trim()).map((input) => `{${input.name}}`),
    ...BUILTIN_TOKENS,
  ]

  const canSave =
    name.trim() !== '' &&
    description.trim() !== '' &&
    urlTemplate.trim() !== '' &&
    (authType !== 'header' || authHeaderName.trim() !== '')

  const handleSave = () => {
    if (!canSave) return
    setError(null)

    const auth =
      authType === 'header'
        ? { type: authType, headerName: authHeaderName.trim() }
        : { type: authType }

    const base = {
      name: name.trim(),
      description: description.trim(),
      method,
      urlTemplate: urlTemplate.trim(),
      headers: headers.filter((header) => header.name.trim()),
      auth,
      inputs: inputs.filter((input) => input.name.trim()),
      bodyTemplate: method === 'POST' ? bodyTemplate.trim() || undefined : undefined,
      timeoutMs,
      enabled,
    }

    const onSuccess = () => onOpenChange(false)
    const onError = (err: unknown) =>
      setError(err instanceof Error ? err.message : 'Could not save the connector')

    if (connector) {
      update.mutate(
        {
          id: connector.id,
          ...base,
          ...(clearSecret
            ? { clearSecret: true }
            : secretDraft.trim()
              ? { secret: secretDraft.trim() }
              : {}),
        },
        { onSuccess, onError }
      )
    } else {
      create.mutate(
        { ...base, ...(secretDraft.trim() ? { secret: secretDraft.trim() } : {}) },
        { onSuccess, onError }
      )
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !saving && onOpenChange(next)}>
      <DialogContent className="flex max-h-[85vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader className="shrink-0 border-b border-border/50 px-6 py-4">
          <DialogTitle>{connector ? 'Edit connector' : 'New connector'}</DialogTitle>
          <DialogDescription>
            Define an external API call the AI assistant can use as a tool.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="min-h-0 flex-1">
          <div className="space-y-5 px-6 py-5">
            <div className="space-y-2">
              <Label htmlFor="connector-name">Name</Label>
              <Input
                id="connector-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Look up order"
                disabled={saving}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="connector-description">Description</Label>
              <Textarea
                id="connector-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What this tool does, shown to the assistant"
                disabled={saving}
              />
            </div>

            <div className="grid grid-cols-[120px_1fr] gap-3">
              <div className="space-y-2">
                <Label htmlFor="connector-method">Method</Label>
                <Select
                  value={method}
                  onValueChange={(v) => setMethod(v as ConnectorMethod)}
                  disabled={saving}
                >
                  <SelectTrigger id="connector-method">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="GET">GET</SelectItem>
                    <SelectItem value="POST">POST</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="connector-url">URL template</Label>
                <Input
                  id="connector-url"
                  value={urlTemplate}
                  onChange={(e) => setUrlTemplate(e.target.value)}
                  placeholder="https://api.example.com/orders/{order_id}"
                  disabled={saving}
                />
              </div>
            </div>

            <ConnectorHeadersEditor headers={headers} onChange={setHeaders} disabled={saving} />

            <div className="space-y-3 rounded-lg border border-border/50 p-3">
              <div className="space-y-2">
                <Label htmlFor="connector-auth-type">Authentication</Label>
                <Select
                  value={authType}
                  onValueChange={(v) => setAuthType(v as ConnectorAuthType)}
                  disabled={saving}
                >
                  <SelectTrigger id="connector-auth-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {AUTH_TYPES.map((authOption) => (
                      <SelectItem key={authOption.value} value={authOption.value}>
                        {authOption.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {authType === 'header' && (
                <div className="space-y-2">
                  <Label htmlFor="connector-auth-header-name">Header name</Label>
                  <Input
                    id="connector-auth-header-name"
                    value={authHeaderName}
                    onChange={(e) => setAuthHeaderName(e.target.value)}
                    placeholder="X-Api-Key"
                    disabled={saving}
                  />
                </div>
              )}

              {authType !== 'none' && (
                <div className="space-y-2">
                  <Label htmlFor="connector-secret">Secret</Label>
                  <Input
                    id="connector-secret"
                    type="password"
                    autoComplete="off"
                    spellCheck={false}
                    value={secretDraft}
                    onChange={(e) => setSecretDraft(e.target.value)}
                    placeholder={connector?.hasSecret ? 'Leave blank to keep the current secret' : ''}
                    disabled={saving || clearSecret}
                  />
                  {connector?.hasSecret && (
                    <label className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Checkbox
                        checked={clearSecret}
                        onCheckedChange={(v) => setClearSecret(v === true)}
                        disabled={saving}
                        aria-label="Clear the stored secret"
                      />
                      Clear the stored secret
                    </label>
                  )}
                </div>
              )}
            </div>

            <ConnectorInputsEditor inputs={inputs} onChange={setInputs} disabled={saving} />

            {method === 'POST' && (
              <div className="space-y-2">
                <Label htmlFor="connector-body">Body template</Label>
                <Textarea
                  id="connector-body"
                  value={bodyTemplate}
                  onChange={(e) => setBodyTemplate(e.target.value)}
                  placeholder={'{\n  "order_id": "{order_id}"\n}'}
                  className="font-mono text-xs"
                  rows={4}
                  disabled={saving}
                />
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="connector-timeout">Timeout (ms)</Label>
              <Input
                id="connector-timeout"
                type="number"
                min={1}
                max={30000}
                value={timeoutMs}
                onChange={(e) => setTimeoutMs(e.target.valueAsNumber || 0)}
                disabled={saving}
                className="w-32"
              />
            </div>

            <div className="flex items-center justify-between rounded-lg border p-4">
              <div>
                <Label htmlFor="connector-enabled" className="text-sm font-medium">
                  Connector enabled
                </Label>
                <p className="text-xs text-muted-foreground">
                  Live connectors are available to the assistant as a tool.
                </p>
              </div>
              <Switch
                id="connector-enabled"
                checked={enabled}
                onCheckedChange={setEnabled}
                disabled={saving}
                aria-label="Toggle connector enabled"
              />
            </div>

            <div className="rounded-lg bg-muted/30 p-3 text-xs text-muted-foreground">
              <p className="font-medium text-foreground">Template variables</p>
              <p className="mt-1">
                Use these in the URL, headers, and body:{' '}
                {templateTokens.map((token) => (
                  <code key={token} className="mx-0.5 rounded bg-muted px-1 py-0.5">
                    {token}
                  </code>
                ))}
              </p>
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}

            {connector ? (
              <TestConnectorPanel
                connectorId={connector.id}
                inputs={connector.inputs}
                method={connector.method}
                urlTemplate={connector.urlTemplate}
                bodyTemplate={connector.bodyTemplate}
              />
            ) : (
              <p className="text-xs text-muted-foreground">
                Save the connector first, then edit it to run a test call.
              </p>
            )}
          </div>
        </ScrollArea>

        <DialogFooter className="shrink-0 border-t border-border/50 px-6 py-4">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button type="button" onClick={handleSave} disabled={saving || !canSave}>
            {saving ? 'Saving...' : connector ? 'Save changes' : 'Create connector'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
