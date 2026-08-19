/**
 * The DnD custom-field editor for one ticket type (convergence Phase 4) —
 * extracted from ticket-types-manager.tsx. Reorder by drag, add/edit/delete
 * through the field dialog, per-field customer visibility on customer-category
 * types. Field validity is gated by the shared `ticketFormFieldSchema` (its
 * superRefine rejects duplicate keys); a fresh field's key is derived unique
 * up front (`uniqueFieldKey`), an existing field keeps its key.
 */
import { useEffect, useState } from 'react'
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
import { PlusIcon, Bars3Icon, TrashIcon, PencilSquareIcon } from '@heroicons/react/24/solid'
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
import type { TicketType } from '@/lib/shared/db-types'
import { TICKET_FORM_FIELD_TYPES } from '@/lib/shared/tickets'
import type { TicketFormField, TicketFormFieldType } from '@/lib/shared/tickets'
import { ticketFormFieldSchema, deriveFieldKey, uniqueFieldKey } from './form-field-schema'

const FIELD_TYPES = TICKET_FORM_FIELD_TYPES

const FIELD_TYPE_LABEL: Record<TicketFormFieldType, string> = {
  text: 'Text',
  long_text: 'Long text',
  number: 'Number',
  select: 'Select',
  date: 'Date',
  checkbox: 'Checkbox',
}

export interface FieldsEditorProps {
  category: TicketType
  fields: TicketFormField[]
  onChange: (next: TicketFormField[]) => void
}

export function FieldsEditor({ category, fields, onChange }: FieldsEditorProps) {
  // Only customer-category fields can be customer-visible; internal categories
  // force visibleToCustomer false (customers never see internal tickets).
  const internal = category !== 'customer'
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
    onChange(arrayMove(fields, oldIndex, newIndex))
  }

  function toggleVisible(field: TicketFormField, visibleToCustomer: boolean) {
    onChange(fields.map((f) => (f.key === field.key ? { ...f, visibleToCustomer } : f)))
  }

  function removeField(field: TicketFormField) {
    onChange(fields.filter((f) => f.key !== field.key))
  }

  function saveField(draft: TicketFormField) {
    const exists = fields.some((f) => f.key === draft.key)
    onChange(exists ? fields.map((f) => (f.key === draft.key ? draft : f)) : [...fields, draft])
  }

  return (
    <div className="space-y-2 rounded-lg border border-border/50 p-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-muted-foreground">
          Fields — answers land in customAttributes
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            setEditing(null)
            setDialogOpen(true)
          }}
        >
          <PlusIcon className="h-4 w-4" /> Add field
        </Button>
      </div>

      <FixedFieldRow label="Subject" typeLabel="Text" />
      <FixedFieldRow label="Details" typeLabel="Long text" />

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={fields.map((f) => f.key)} strategy={verticalListSortingStrategy}>
          <div className="space-y-1.5">
            {fields.map((field) => (
              <FieldRow
                key={field.key}
                field={field}
                internal={internal}
                onToggleVisible={(v) => toggleVisible(field, v)}
                onEdit={() => {
                  setEditing(field)
                  setDialogOpen(true)
                }}
                onDelete={() => removeField(field)}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>

      {fields.length === 0 && (
        <p className="py-1 text-xs text-muted-foreground">No custom fields yet.</p>
      )}

      <FieldDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        field={editing}
        internal={internal}
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
      className="group/field flex items-center gap-3 rounded-md border border-border/50 bg-card px-3 py-2"
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        className="w-4 shrink-0 touch-none cursor-grab active:cursor-grabbing"
        aria-label="Reorder"
      >
        <Bars3Icon className="h-4 w-4 text-muted-foreground opacity-0 group-hover/field:opacity-100" />
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
        type="button"
        variant="ghost"
        size="icon"
        className="h-7 w-7 text-muted-foreground opacity-0 group-hover/field:opacity-100"
        onClick={onEdit}
        title="Edit field"
      >
        <PencilSquareIcon className="h-3.5 w-3.5" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-7 w-7 text-muted-foreground opacity-0 group-hover/field:opacity-100 hover:text-destructive"
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
