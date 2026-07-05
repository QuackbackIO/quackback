'use client'

import { useMemo, useState } from 'react'
import { PlayIcon } from '@heroicons/react/24/outline'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { WarningBox } from '@/components/shared/warning-box'
import { useTestConnector } from '@/lib/client/mutations/connectors'
import { buildSampleValues } from './connector-sample-values'
import { renderConnectorPreview } from './connector-template-preview'
import { describeConnectorTestResult } from './connector-test-result'
import type {
  ConnectorExecutionResult,
  ConnectorInputField,
  ConnectorMethod,
} from '@/lib/server/domains/connectors/connector.types'
import type { DataConnectorId } from '@quackback/ids'

interface TestConnectorPanelProps {
  connectorId: DataConnectorId
  inputs: ConnectorInputField[]
  method: ConnectorMethod
  urlTemplate: string
  bodyTemplate: string | null
}

/** Shows a text/number/checkbox field per declared input, not undefined. */
function textFieldValue(value: string | number | boolean | undefined): string | number {
  if (value === undefined) return ''
  if (typeof value === 'number' && Number.isNaN(value)) return ''
  if (typeof value === 'boolean') return ''
  return value
}

/**
 * Collects sample values for a connector's declared inputs, runs a live test
 * call against the saved (persisted) configuration, and renders the
 * captured response — the same call that becomes the connector's stored
 * example_response.
 */
export function TestConnectorPanel({
  connectorId,
  inputs,
  method,
  urlTemplate,
  bodyTemplate,
}: TestConnectorPanelProps) {
  const [draft, setDraft] = useState<Record<string, string | number | boolean>>({})
  const [result, setResult] = useState<ConnectorExecutionResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const test = useTestConnector()

  const sampleValues = useMemo(() => buildSampleValues(inputs, draft), [inputs, draft])
  const previewUrl = useMemo(
    () => renderConnectorPreview(urlTemplate, sampleValues),
    [urlTemplate, sampleValues]
  )
  const previewBody =
    method === 'POST' && bodyTemplate ? renderConnectorPreview(bodyTemplate, sampleValues) : null

  const handleRun = () => {
    setError(null)
    test.mutate(
      { id: connectorId, sampleValues },
      {
        onSuccess: (data) => setResult(data),
        onError: (err) => setError(err instanceof Error ? err.message : 'The test call failed'),
      }
    )
  }

  const outcome = result ? describeConnectorTestResult(result) : null

  return (
    <div className="space-y-4 rounded-lg border border-border/50 p-4">
      <div>
        <h4 className="text-sm font-medium">Test connector</h4>
        <p className="text-xs text-muted-foreground">
          Runs against the saved configuration. Save your changes first to test them. A successful
          response becomes the example the assistant sees.
        </p>
      </div>

      {inputs.length > 0 && (
        <div className="space-y-3">
          {inputs.map((input) => (
            <div key={input.name} className="space-y-1.5">
              <Label htmlFor={`test-input-${input.name}`}>
                {input.name}
                {input.required && <span className="text-destructive"> *</span>}
              </Label>
              {input.type === 'boolean' ? (
                <Checkbox
                  id={`test-input-${input.name}`}
                  checked={Boolean(draft[input.name])}
                  onCheckedChange={(v) => setDraft((d) => ({ ...d, [input.name]: v === true }))}
                  aria-label={input.name}
                />
              ) : (
                <Input
                  id={`test-input-${input.name}`}
                  type={input.type === 'number' ? 'number' : 'text'}
                  value={textFieldValue(draft[input.name])}
                  onChange={(e) =>
                    setDraft((d) => ({
                      ...d,
                      [input.name]: input.type === 'number' ? e.target.valueAsNumber : e.target.value,
                    }))
                  }
                  placeholder={input.description}
                  aria-label={input.name}
                />
              )}
            </div>
          ))}
        </div>
      )}

      <div className="space-y-1.5 rounded-md bg-muted/30 p-3">
        <p className="text-xs font-medium text-muted-foreground">Request preview</p>
        <code className="block break-all text-xs">
          {method} {previewUrl}
        </code>
        {previewBody && (
          <code className="block whitespace-pre-wrap break-all text-xs">{previewBody}</code>
        )}
      </div>

      <Button type="button" size="sm" onClick={handleRun} disabled={test.isPending}>
        <PlayIcon className="h-4 w-4 mr-1.5" />
        {test.isPending ? 'Running...' : 'Run test'}
      </Button>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {outcome &&
        (outcome.ok ? (
          <div className="space-y-2">
            <div className="rounded-lg border border-green-500/20 bg-green-500/10 p-3 text-sm text-green-700 dark:text-green-400">
              {outcome.title}
            </div>
            {result?.ok && (
              <pre className="max-h-64 overflow-auto rounded-md bg-muted/50 p-3 text-xs">
                {JSON.stringify(result.data, null, 2)}
              </pre>
            )}
          </div>
        ) : (
          <WarningBox variant="destructive" title={outcome.title} description={outcome.detail} />
        ))}
    </div>
  )
}
