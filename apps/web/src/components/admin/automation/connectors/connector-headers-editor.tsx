'use client'

import { PlusIcon, TrashIcon } from '@heroicons/react/24/outline'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { ConnectorHeader } from '@/lib/server/domains/connectors/connector.types'

interface ConnectorHeadersEditorProps {
  headers: ConnectorHeader[]
  onChange: (headers: ConnectorHeader[]) => void
  disabled?: boolean
}

/** Static request headers sent with every call; a header's value may use the
 *  same `{token}` placeholders as the URL and body. */
export function ConnectorHeadersEditor({ headers, onChange, disabled }: ConnectorHeadersEditorProps) {
  const update = (index: number, patch: Partial<ConnectorHeader>) =>
    onChange(headers.map((header, i) => (i === index ? { ...header, ...patch } : header)))
  const remove = (index: number) => onChange(headers.filter((_, i) => i !== index))
  const add = () => onChange([...headers, { name: '', value: '' }])

  return (
    <div className="space-y-2">
      <Label>Headers</Label>
      {headers.length === 0 && <p className="text-xs text-muted-foreground">No custom headers.</p>}
      {headers.map((header, index) => (
        <div key={index} className="flex items-center gap-2">
          <Input
            value={header.name}
            onChange={(e) => update(index, { name: e.target.value })}
            placeholder="X-Api-Version"
            aria-label={`Header ${index + 1} name`}
            disabled={disabled}
            className="w-1/3"
          />
          <Input
            value={header.value}
            onChange={(e) => update(index, { value: e.target.value })}
            placeholder="2024-01-01"
            aria-label={`Header ${index + 1} value`}
            disabled={disabled}
            className="flex-1"
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={`Remove header ${index + 1}`}
            onClick={() => remove(index)}
            disabled={disabled}
          >
            <TrashIcon className="h-4 w-4" />
          </Button>
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" onClick={add} disabled={disabled}>
        <PlusIcon className="h-4 w-4 mr-1.5" />
        Add header
      </Button>
    </div>
  )
}
