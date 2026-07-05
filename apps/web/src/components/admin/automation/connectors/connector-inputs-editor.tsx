'use client'

import { PlusIcon, TrashIcon } from '@heroicons/react/24/outline'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type {
  ConnectorInputField,
  ConnectorInputType,
} from '@/lib/server/domains/connectors/connector.types'

const INPUT_TYPES: ConnectorInputType[] = ['string', 'number', 'boolean']

interface ConnectorInputsEditorProps {
  inputs: ConnectorInputField[]
  onChange: (inputs: ConnectorInputField[]) => void
  disabled?: boolean
}

/** Declared inputs become the tool's model-facing parameters; each name also
 *  becomes a `{token}` placeholder available in the URL, headers, and body. */
export function ConnectorInputsEditor({ inputs, onChange, disabled }: ConnectorInputsEditorProps) {
  const update = (index: number, patch: Partial<ConnectorInputField>) =>
    onChange(inputs.map((input, i) => (i === index ? { ...input, ...patch } : input)))
  const remove = (index: number) => onChange(inputs.filter((_, i) => i !== index))
  const add = () => onChange([...inputs, { name: '', type: 'string', required: false }])

  return (
    <div className="space-y-2">
      <Label>Inputs</Label>
      <p className="text-xs text-muted-foreground">
        Parameters the assistant fills in. Each becomes a{' '}
        <code className="bg-muted px-1 rounded">{'{name}'}</code> placeholder.
      </p>
      {inputs.length === 0 && <p className="text-xs text-muted-foreground">No declared inputs.</p>}
      {inputs.map((input, index) => (
        <div key={index} className="space-y-2 rounded-lg border border-border/50 p-3">
          <div className="flex items-center gap-2">
            <Input
              value={input.name}
              onChange={(e) => update(index, { name: e.target.value })}
              placeholder="order_id"
              aria-label={`Input ${index + 1} name`}
              disabled={disabled}
              className="flex-1"
            />
            <Select
              value={input.type}
              onValueChange={(v) => update(index, { type: v as ConnectorInputType })}
              disabled={disabled}
            >
              <SelectTrigger className="w-28" aria-label={`Input ${index + 1} type`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {INPUT_TYPES.map((type) => (
                  <SelectItem key={type} value={type}>
                    {type}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={`Remove input ${index + 1}`}
              onClick={() => remove(index)}
              disabled={disabled}
            >
              <TrashIcon className="h-4 w-4" />
            </Button>
          </div>
          <Input
            value={input.description ?? ''}
            onChange={(e) => update(index, { description: e.target.value })}
            placeholder="Description shown to the assistant"
            aria-label={`Input ${index + 1} description`}
            disabled={disabled}
          />
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <Checkbox
              checked={input.required ?? false}
              onCheckedChange={(v) => update(index, { required: v === true })}
              disabled={disabled}
              aria-label={`Input ${index + 1} required`}
            />
            Required
          </label>
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" onClick={add} disabled={disabled}>
        <PlusIcon className="h-4 w-4 mr-1.5" />
        Add input
      </Button>
    </div>
  )
}
