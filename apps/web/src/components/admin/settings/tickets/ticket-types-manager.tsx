import { useEffect, useState } from 'react'
import { useSuspenseQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  PlusIcon,
  Bars3Icon,
  TrashIcon,
  PencilSquareIcon,
  LockClosedIcon,
} from '@heroicons/react/24/solid'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Checkbox } from '@/components/ui/checkbox'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import { cn } from '@/lib/shared/utils'
import { TICKET_TYPES } from '@/lib/shared/db-types'
import type { TicketType } from '@/lib/shared/db-types'
import { TICKET_FORM_FIELD_TYPES } from '@/lib/shared/tickets'
import type { TicketFormField, TicketFormFieldType } from '@/lib/shared/tickets'
import { setTicketFormFn } from '@/lib/server/functions/tickets'
import { ticketFormsQuery } from './queries'
import {
  ticketFormFieldSchema,
  deriveFieldKey,
  uniqueFieldKey,
  findDuplicateKey,
} from './form-field-schema'

const TYPE_META: Record<
  TicketType,
  { label: string; note: string; internal: boolean; isDefault: boolean }
> = {
  customer: {
    label: 'Customer',
    note: 'Customers submit these from the portal and Messenger.',
    internal: false,
    isDefault: true,
  },
  back_office: {
    label: 'Back-office',
    note: 'Internal only. Your team creates these; customers never see them.',
    internal: true,
    isDefault: false,
  },
  tracker: {
    label: 'Tracker',
    note: 'Internal work item. Status changes cascade to linked tickets.',
    internal: true,
    isDefault: false,
  },
}

const FIELD_TYPES = TICKET_FORM_FIELD_TYPES

const FIELD_TYPE_LABEL: Record<TicketFormFieldType, string> = {
  text: 'Text',
  long_text: 'Long text',
  number: 'Number',
  select: 'Select',
  date: 'Date',
  checkbox: 'Checkbox',
}

const KEY = ticketFormsQuery.queryKey

export function TicketTypesManager() {
  const qc = useQueryClient()
  const { data: forms } = useSuspenseQuery(ticketFormsQuery)
  const [selected, setSelected] = useState<TicketType>('customer')

  const fields = forms[selected]

  async function persist(next: TicketFormField[]) {
    const ordered = next.map((f, i) => ({ ...f, order: i }))
    const prev = forms
    qc.setQueryData(KEY, { ...forms, [selected]: ordered })
    try {
      const saved = await setTicketFormFn({ data: { type: selected, fields: ordered } })
      qc.setQueryData(KEY, saved)
    } catch (error) {
      qc.setQueryData(KEY, prev)
      toast.error(error instanceof Error ? error.message : 'Failed to save form')
    }
  }

  return (
    <SettingsCard
      title="New Ticket forms"
      description="Each ticket type has its own intake form. Subject and Details are always present; add custom fields below."
      contentClassName="p-0"
    >
      <div className="grid md:grid-cols-[220px_1fr] divide-y md:divide-y-0 md:divide-x divide-border/50">
        <ul className="p-2">
          {TICKET_TYPES.map((type) => {
            const meta = TYPE_META[type]
            const isActive = selected === type
            return (
              <li key={type}>
                <button
                  type="button"
                  onClick={() => setSelected(type)}
                  className={cn(
                    'w-full rounded-lg px-3 py-2.5 text-left transition-colors',
                    isActive ? 'bg-muted' : 'hover:bg-muted/50'
                  )}
                >
                  <span className="flex items-center gap-2">
                    <span className="text-sm font-medium">{meta.label}</span>
                    {meta.isDefault && (
                      <Badge variant="subtle" className="shrink-0">
                        Default
                      </Badge>
                    )}
                    {meta.internal && (
                      <LockClosedIcon
                        className="h-3 w-3 text-muted-foreground"
                        aria-label="Internal"
                      />
                    )}
                  </span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">{meta.note}</span>
                </button>
              </li>
            )
          })}
        </ul>

        <FormBuilder type={selected} fields={fields} onChange={persist} />
      </div>
    </SettingsCard>
  )
}

interface FormBuilderProps {
  type: TicketType
  fields: TicketFormField[]
  onChange: (next: TicketFormField[]) => Promise<void>
}

function FormBuilder({ type, fields, onChange }: FormBuilderProps) {
  const meta = TYPE_META[type]
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<TicketFormField | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = fields.findIndex((f) => f.key === active.id)
    const newIndex = fields.findIndex((f) => f.key === over.id)
    if (oldIndex === -1 || newIndex === -1) return
    void onChange(arrayMove(fields, oldIndex, newIndex))
  }

  function toggleVisible(field: TicketFormField, visibleToCustomer: boolean) {
    void onChange(fields.map((f) => (f.key === field.key ? { ...f, visibleToCustomer } : f)))
  }

  function removeField(field: TicketFormField) {
    void onChange(fields.filter((f) => f.key !== field.key))
  }

  function saveField(draft: TicketFormField) {
    const exists = fields.some((f) => f.key === draft.key)
    const next = exists ? fields.map((f) => (f.key === draft.key ? draft : f)) : [...fields, draft]
    void onChange(next)
  }

  return (
    <div className="p-4 sm:p-6 space-y-5">
      {meta.internal ? (
        <p className="rounded-lg border border-border/50 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          {meta.note}
        </p>
      ) : (
        <div className="flex items-center justify-between rounded-lg border border-border/50 bg-muted/30 px-3 py-2.5">
          <div className="pr-4">
            <Label className="text-sm font-medium">Customers can submit</Label>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Customer tickets are submitted by your customers from the portal and Messenger.
            </p>
          </div>
          <Badge variant="subtle" className="shrink-0">
            Built-in
          </Badge>
        </div>
      )}

      <div className="space-y-1.5">
        <p className="text-xs font-medium text-muted-foreground">Fields</p>
        <FixedFieldRow label="Subject" typeLabel="Text" />
        <FixedFieldRow label="Details" typeLabel="Long text" />

        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={fields.map((f) => f.key)} strategy={verticalListSortingStrategy}>
            {fields.map((field) => (
              <FieldRow
                key={field.key}
                field={field}
                internal={meta.internal}
                onToggleVisible={(v) => toggleVisible(field, v)}
                onEdit={() => {
                  setEditing(field)
                  setDialogOpen(true)
                }}
                onDelete={() => removeField(field)}
              />
            ))}
          </SortableContext>
        </DndContext>

        {fields.length === 0 && (
          <p className="py-2 text-xs text-muted-foreground">No custom fields yet.</p>
        )}
      </div>

      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          setEditing(null)
          setDialogOpen(true)
        }}
      >
        <PlusIcon className="h-4 w-4" /> Add field
      </Button>

      <FieldDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        field={editing}
        internal={meta.internal}
        existingKeys={fields.map((f) => f.key)}
        onSubmit={saveField}
      />
    </div>
  )
}

/** Built-in Subject / Details rows: always present, never editable. */
function FixedFieldRow({ label, typeLabel }: { label: string; typeLabel: string }) {
  return (
    <div className="flex items-center gap-3 rounded-md border border-dashed border-border/50 px-3 py-2">
      <span className="w-4 shrink-0" />
      <span className="flex-1 text-sm">{label}</span>
      <Badge variant="outline">{typeLabel}</Badge>
      <Badge variant="subtle">Built-in</Badge>
    </div>
  )
}

interface FieldRowProps {
  field: TicketFormField
  internal: boolean
  onToggleVisible: (visible: boolean) => void
  onEdit: () => void
  onDelete: () => void
}

function FieldRow({ field, internal, onToggleVisible, onEdit, onDelete }: FieldRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: field.key,
  })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="group flex items-center gap-3 rounded-md border border-border/50 bg-card px-3 py-2"
    >
      <button
        {...attributes}
        {...listeners}
        className="w-4 shrink-0 touch-none cursor-grab active:cursor-grabbing"
        aria-label="Reorder"
      >
        <Bars3Icon className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100" />
      </button>

      <span className="flex-1 min-w-0 truncate text-sm">{field.label}</span>
      <Badge variant="outline">{FIELD_TYPE_LABEL[field.type]}</Badge>
      {field.required && <Badge variant="subtle">Required</Badge>}

      {internal ? (
        // Internal tickets are never shown to customers, so there is nothing to toggle.
        <span className="w-16" aria-hidden />
      ) : (
        <span className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground">Visible</span>
          <Switch
            checked={field.visibleToCustomer}
            onCheckedChange={onToggleVisible}
            aria-label={`Show ${field.label} to customers`}
          />
        </span>
      )}

      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7 text-muted-foreground opacity-0 group-hover:opacity-100"
        onClick={onEdit}
        title="Edit field"
      >
        <PencilSquareIcon className="h-3.5 w-3.5" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7 text-muted-foreground hover:text-destructive"
        onClick={onDelete}
        title="Delete field"
      >
        <TrashIcon className="h-3.5 w-3.5" />
      </Button>
    </div>
  )
}

interface FieldDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  field: TicketFormField | null
  internal: boolean
  existingKeys: string[]
  onSubmit: (field: TicketFormField) => void
}

function FieldDialog({
  open,
  onOpenChange,
  field,
  internal,
  existingKeys,
  onSubmit,
}: FieldDialogProps) {
  const [label, setLabel] = useState('')
  const [fieldType, setFieldType] = useState<TicketFormFieldType>('text')
  const [required, setRequired] = useState(false)
  const [visibleToCustomer, setVisibleToCustomer] = useState(true)
  const [optionsText, setOptionsText] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setError(null)
    if (field) {
      setLabel(field.label)
      setFieldType(field.type)
      setRequired(field.required)
      setVisibleToCustomer(field.visibleToCustomer)
      setOptionsText((field.options ?? []).join('\n'))
    } else {
      setLabel('')
      setFieldType('text')
      setRequired(false)
      setVisibleToCustomer(!internal)
      setOptionsText('')
    }
  }, [open, field, internal])

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const options =
      fieldType === 'select'
        ? optionsText
            .split('\n')
            .map((o) => o.trim())
            .filter(Boolean)
        : undefined

    // Preserve an existing field's key; derive a fresh unique one otherwise.
    const key = field ? field.key : uniqueFieldKey(deriveFieldKey(label), existingKeys)

    const draft: TicketFormField = {
      key,
      label: label.trim(),
      type: fieldType,
      required,
      visibleToCustomer: internal ? false : visibleToCustomer,
      order: field?.order ?? existingKeys.length,
      ...(options ? { options } : {}),
    }

    const parsed = ticketFormFieldSchema.safeParse(draft)
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Invalid field')
      return
    }
    const others = field ? existingKeys.filter((k) => k !== field.key) : existingKeys
    if (findDuplicateKey([...others.map((k) => ({ key: k })), { key }])) {
      setError('Another field already uses this name.')
      return
    }
    onSubmit(draft)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{field ? 'Edit field' : 'Add field'}</DialogTitle>
          <DialogDescription>
            Custom fields appear on this type&apos;s New Ticket form.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="field-label">Field name</Label>
            <Input
              id="field-label"
              value={label}
              maxLength={120}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. Order number"
              required
            />
          </div>

          <div className="space-y-2">
            <Label>Type</Label>
            <Select value={fieldType} onValueChange={(v) => setFieldType(v as TicketFormFieldType)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FIELD_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {FIELD_TYPE_LABEL[t]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {fieldType === 'select' && (
            <div className="space-y-2">
              <Label htmlFor="field-options">Options</Label>
              <Textarea
                id="field-options"
                value={optionsText}
                rows={3}
                onChange={(e) => setOptionsText(e.target.value)}
                placeholder="One option per line"
              />
            </div>
          )}

          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={required} onCheckedChange={(v) => setRequired(v === true)} />
            Required
          </label>

          {!internal && (
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={visibleToCustomer}
                onCheckedChange={(v) => setVisibleToCustomer(v === true)}
              />
              Show to customers on the New Ticket form
            </label>
          )}

          {error && <p className="text-xs text-destructive">{error}</p>}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!label.trim()}>
              {field ? 'Save field' : 'Add field'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
