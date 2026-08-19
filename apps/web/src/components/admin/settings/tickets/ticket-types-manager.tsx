/**
 * The ticket-types registry manager (convergence Phase 4,
 * scratchpad/convergence-design.md): the workspace's user-defined ticket
 * kinds. A type is a label + icon + color + typed field set WITHIN one of the
 * three fixed categories; the category drives behavior (cascade rules, portal
 * visibility, SLA), the type defines the fields a ticket captures.
 *
 * List + create/edit dialog (identity + the DnD field editor per type, which
 * lives in ./fields-editor.tsx) + archive/restore. Archive-not-delete: in-use
 * types stay on ticket history forever. Permission `ticket.manage_types` is
 * enforced by the route and re-checked by every server fn.
 */
import { useEffect, useState } from 'react'
import { useSuspenseQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  PlusIcon,
  PencilSquareIcon,
  ArchiveBoxIcon,
  ArrowUturnLeftIcon,
} from '@heroicons/react/24/solid'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
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
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import { ColorPickerGrid, ColorHexInput, randomColor } from '@/components/shared/color-picker'
import { TICKET_TYPES } from '@/lib/shared/db-types'
import type { TicketType } from '@/lib/shared/db-types'
import type { TicketFormField, TicketTypeDTO } from '@/lib/shared/tickets'
import { ticketTypeLabel } from '@/components/admin/inbox/ticket-chips'
import {
  createTicketTypeFn,
  updateTicketTypeFn,
  archiveTicketTypeFn,
  restoreTicketTypeFn,
} from '@/lib/server/functions/ticket-types'
import { ticketTypesQuery } from './queries'
import { FieldsEditor } from './fields-editor'

/** Category presentation for the registry rows (label comes from the shared
 *  ticketTypeLabel so the inbox chips can't drift). */
const CATEGORY_NOTE: Record<TicketType, string> = {
  customer: 'Customers submit these from the portal and Messenger.',
  back_office: 'Internal only — customers never see them.',
  tracker: 'Internal work item. Status changes cascade to linked tickets.',
}

export function TicketTypesManager() {
  const qc = useQueryClient()
  const { data: types } = useSuspenseQuery(ticketTypesQuery)

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<TicketTypeDTO | null>(null)
  const [toArchive, setToArchive] = useState<TicketTypeDTO | null>(null)

  const live = types.filter((t) => !t.archived)
  const archived = types.filter((t) => t.archived)

  async function refresh() {
    await qc.invalidateQueries({ queryKey: ticketTypesQuery.queryKey })
  }

  async function handleArchive() {
    if (!toArchive) return
    try {
      await archiveTicketTypeFn({ data: { id: toArchive.id } })
      toast.success(`Archived "${toArchive.name}"`)
      await refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to archive type')
    } finally {
      setToArchive(null)
    }
  }

  async function handleRestore(type: TicketTypeDTO) {
    try {
      await restoreTicketTypeFn({ data: { id: type.id } })
      toast.success(`Restored "${type.name}"`)
      await refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to restore type')
    }
  }

  return (
    <SettingsCard
      title="Ticket types"
      description="Types define the fields a ticket captures. Each type belongs to a category, which drives its behavior."
      action={
        <Button
          size="sm"
          onClick={() => {
            setEditing(null)
            setDialogOpen(true)
          }}
        >
          <PlusIcon className="h-4 w-4" /> New type
        </Button>
      }
      contentClassName="p-0"
    >
      <div className="divide-y divide-border/40">
        {TICKET_TYPES.map((category) => {
          const group = live.filter((t) => t.category === category)
          if (group.length === 0) return null
          return (
            <div key={category}>
              <div className="px-4 sm:px-6 pt-4 pb-1.5">
                <p className="text-xs font-medium text-muted-foreground">
                  {ticketTypeLabel(category)}
                  <span className="font-normal"> · {CATEGORY_NOTE[category]}</span>
                </p>
              </div>
              {group.map((type) => (
                <TypeRow
                  key={type.id}
                  type={type}
                  onEdit={() => {
                    setEditing(type)
                    setDialogOpen(true)
                  }}
                  onArchive={() => setToArchive(type)}
                />
              ))}
            </div>
          )
        })}

        {archived.length > 0 && (
          <div>
            <div className="px-4 sm:px-6 pt-4 pb-1.5">
              <p className="text-xs font-medium text-muted-foreground">
                Archived
                <span className="font-normal"> · kept on ticket history, hidden from pickers.</span>
              </p>
            </div>
            {archived.map((type) => (
              <TypeRow key={type.id} type={type} onRestore={() => handleRestore(type)} />
            ))}
          </div>
        )}
      </div>

      <TypeEditorDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        type={editing}
        onSaved={refresh}
      />

      <ConfirmDialog
        open={!!toArchive}
        onOpenChange={() => setToArchive(null)}
        title="Archive type"
        description={`Archive "${toArchive?.name}"? It stays on existing tickets but leaves every picker. You can restore it later.`}
        confirmLabel="Archive"
        variant="destructive"
        onConfirm={handleArchive}
      />
    </SettingsCard>
  )
}

interface TypeRowProps {
  type: TicketTypeDTO
  onEdit?: () => void
  onArchive?: () => void
  onRestore?: () => void
}

function TypeRow({ type, onEdit, onArchive, onRestore }: TypeRowProps) {
  const fieldSummary =
    type.fields.length === 0
      ? 'No custom fields'
      : `${type.fields.length} field${type.fields.length === 1 ? '' : 's'} · ${type.fields
          .slice(0, 5)
          .map((f) => f.label)
          .join(', ')}${type.fields.length > 5 ? ', …' : ''}`
  return (
    <div className="group flex items-center gap-3 px-4 sm:px-6 py-2.5 hover:bg-muted/40">
      <span
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-sm"
        style={{ backgroundColor: `${type.color}1f` }}
        aria-hidden
      >
        {type.icon ?? (
          <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: type.color }} />
        )}
      </span>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="truncate text-sm font-medium">{type.name}</span>
          <Badge variant="outline" className="shrink-0">
            {ticketTypeLabel(type.category)}
          </Badge>
          {type.isDefault && !type.archived && (
            <Badge variant="subtle" className="shrink-0">
              Default
            </Badge>
          )}
          {type.category !== 'customer' && (
            <Badge variant="subtle" className="shrink-0">
              Internal
            </Badge>
          )}
          {type.archived && (
            <Badge variant="subtle" className="shrink-0">
              Archived
            </Badge>
          )}
        </div>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">
          {fieldSummary}
          {type.ticketCount !== undefined && type.ticketCount > 0
            ? ` · ${type.ticketCount} ticket${type.ticketCount === 1 ? '' : 's'}`
            : ''}
        </p>
      </div>

      <div className="shrink-0 flex items-center justify-end gap-0.5">
        {onEdit && (
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground opacity-0 group-hover:opacity-100"
            onClick={onEdit}
            title="Edit type"
          >
            <PencilSquareIcon className="h-3.5 w-3.5" />
          </Button>
        )}
        {onArchive && (
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-destructive"
            onClick={onArchive}
            title="Archive type"
          >
            <ArchiveBoxIcon className="h-3.5 w-3.5" />
          </Button>
        )}
        {onRestore && (
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground opacity-0 group-hover:opacity-100"
            onClick={onRestore}
            title="Restore type"
          >
            <ArrowUturnLeftIcon className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Type editor dialog — identity + the DnD field editor
// ---------------------------------------------------------------------------

interface TypeEditorDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Null = creating. */
  type: TicketTypeDTO | null
  onSaved: () => Promise<void>
}

function TypeEditorDialog({ open, onOpenChange, type, onSaved }: TypeEditorDialogProps) {
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [category, setCategory] = useState<TicketType>('customer')
  const [icon, setIcon] = useState('')
  const [color, setColor] = useState(randomColor())
  const [intakeVisible, setIntakeVisible] = useState(true)
  const [isDefault, setIsDefault] = useState(false)
  const [fields, setFields] = useState<TicketFormField[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const editing = type !== null
  // CATEGORY LOCK: once tickets reference the type its category is fixed —
  // recategorizing would silently rewrite behavior on ticket history.
  const categoryLocked = editing && (type.ticketCount ?? 0) > 0
  // The live default can't be unset directly (the category must always resolve
  // a default); promote another type instead.
  const defaultLocked = editing && type.isDefault && !type.archived

  useEffect(() => {
    if (!open) return
    setError(null)
    if (type) {
      setName(type.name)
      setSlug(type.slug)
      setCategory(type.category)
      setIcon(type.icon ?? '')
      setColor(type.color)
      setIntakeVisible(type.intakeVisible)
      setIsDefault(type.isDefault)
      setFields(type.fields)
    } else {
      setName('')
      setSlug('')
      setCategory('customer')
      setIcon('')
      setColor(randomColor())
      setIntakeVisible(true)
      setIsDefault(false)
      setFields([])
    }
  }, [open, type])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    setSubmitting(true)
    setError(null)
    try {
      const ordered = fields.map((f, i) => ({ ...f, order: i }))
      if (editing) {
        await updateTicketTypeFn({
          data: {
            id: type.id,
            name: name.trim(),
            slug: slug.trim() || undefined,
            ...(categoryLocked ? {} : { category }),
            icon: icon.trim() || null,
            color,
            intakeVisible,
            ...(defaultLocked ? {} : { isDefault }),
            fields: ordered,
          },
        })
        toast.success(`Saved "${name.trim()}"`)
      } else {
        await createTicketTypeFn({
          data: {
            name: name.trim(),
            category,
            slug: slug.trim() || undefined,
            icon: icon.trim() || null,
            color,
            intakeVisible,
            isDefault,
            fields: ordered,
          },
        })
        toast.success(`Created "${name.trim()}"`)
      }
      await onSaved()
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save type')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? 'Edit type' : 'New type'}</DialogTitle>
          <DialogDescription>Behavior comes from the category; fields are yours.</DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-5">
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="ticket-type-name">Name</Label>
              <Input
                id="ticket-type-name"
                value={name}
                maxLength={60}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Bug report"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ticket-type-slug">Slug</Label>
              <Input
                id="ticket-type-slug"
                value={slug}
                maxLength={64}
                onChange={(e) => setSlug(e.target.value)}
                placeholder="auto-generated from name"
              />
              <p className="text-[11px] text-muted-foreground">
                Lowercase letters, digits, underscores. Stable key for API + workflows.
              </p>
            </div>
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Category</Label>
              <Select
                value={category}
                onValueChange={(v) => setCategory(v as TicketType)}
                disabled={categoryLocked}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TICKET_TYPES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {ticketTypeLabel(c)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {categoryLocked && (
                <p className="text-[11px] text-muted-foreground">
                  Locked — {type.ticketCount} ticket{type.ticketCount === 1 ? '' : 's'} use this
                  type. Archive it and create a new type instead.
                </p>
              )}
            </div>
            <div className="grid grid-cols-[64px_1fr] gap-3">
              <div className="space-y-2">
                <Label htmlFor="ticket-type-icon">Icon</Label>
                <Input
                  id="ticket-type-icon"
                  value={icon}
                  maxLength={16}
                  onChange={(e) => setIcon(e.target.value)}
                  placeholder="🐛"
                  className="text-center"
                />
              </div>
              <div className="space-y-2">
                <Label>Color</Label>
                <ColorHexInput color={color} onColorChange={setColor} />
              </div>
            </div>
          </div>

          <ColorPickerGrid selectedColor={color} onColorChange={setColor} />

          <div className="flex flex-wrap gap-x-8 gap-y-3">
            {category === 'customer' && (
              <label className="flex items-center gap-2 text-sm">
                <Switch checked={intakeVisible} onCheckedChange={setIntakeVisible} />
                Show on portal + Messenger intake
              </label>
            )}
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={isDefault} onCheckedChange={setIsDefault} disabled={defaultLocked} />
              Default for {ticketTypeLabel(category)} tickets
            </label>
            {defaultLocked && (
              <p className="w-full text-[11px] text-muted-foreground">
                This is the category default — set another type as default to change it.
              </p>
            )}
          </div>

          <FieldsEditor category={category} fields={fields} onChange={setFields} />

          {error && <p className="text-xs text-destructive">{error}</p>}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting || !name.trim()}>
              {submitting ? 'Saving…' : editing ? 'Save changes' : 'Create type'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
