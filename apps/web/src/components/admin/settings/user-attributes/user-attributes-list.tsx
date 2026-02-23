'use client'

import { useState, useEffect } from 'react'
import { PlusIcon, PencilIcon, TrashIcon } from '@heroicons/react/24/solid'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import { EmptyState } from '@/components/shared/empty-state'

import { SettingsCard } from '@/components/admin/settings/settings-card'
import {
  useCreateUserAttribute,
  useUpdateUserAttribute,
  useDeleteUserAttribute,
} from '@/lib/client/mutations'
import type { UserAttributeItem } from '@/lib/client/hooks/use-user-attributes-queries'
import type { UserAttributeId } from '@quackback/ids'
import { AdjustmentsHorizontalIcon } from '@heroicons/react/24/solid'

// ============================================
// Constants
// ============================================

const ATTRIBUTE_TYPES = [
  { value: 'string', label: 'Text' },
  { value: 'number', label: 'Number' },
  { value: 'boolean', label: 'Boolean' },
  { value: 'date', label: 'Date' },
  { value: 'currency', label: 'Currency' },
] as const

type AttributeType = (typeof ATTRIBUTE_TYPES)[number]['value']

const CURRENCY_CODES = ['USD', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD', 'CHF', 'CNY', 'INR', 'BRL']

const TYPE_BADGE_COLORS: Record<AttributeType, string> = {
  string: 'bg-blue-50 text-blue-700 border-blue-200',
  number: 'bg-green-50 text-green-700 border-green-200',
  boolean: 'bg-purple-50 text-purple-700 border-purple-200',
  date: 'bg-orange-50 text-orange-700 border-orange-200',
  currency: 'bg-emerald-50 text-emerald-700 border-emerald-200',
}

// ============================================
// Create / Edit dialog
// ============================================

interface AttributeFormValues {
  key: string
  label: string
  description: string
  type: AttributeType
  currencyCode: string
  externalKey: string
}

interface AttributeFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialValues?: Partial<AttributeFormValues> & { id?: UserAttributeId }
  onSubmit: (values: AttributeFormValues) => Promise<void>
  isPending?: boolean
}

function AttributeFormDialog({
  open,
  onOpenChange,
  initialValues,
  onSubmit,
  isPending,
}: AttributeFormDialogProps) {
  const isEditing = !!initialValues?.id

  const [key, setKey] = useState(initialValues?.key ?? '')
  const [label, setLabel] = useState(initialValues?.label ?? '')
  const [description, setDescription] = useState(initialValues?.description ?? '')
  const [type, setType] = useState<AttributeType>(initialValues?.type ?? 'string')
  const [currencyCode, setCurrencyCode] = useState(initialValues?.currencyCode ?? 'USD')
  const [externalKey, setExternalKey] = useState(initialValues?.externalKey ?? '')

  useEffect(() => {
    if (open) {
      setKey(initialValues?.key ?? '')
      setLabel(initialValues?.label ?? '')
      setDescription(initialValues?.description ?? '')
      setType(initialValues?.type ?? 'string')
      setCurrencyCode(initialValues?.currencyCode ?? 'USD')
      setExternalKey(initialValues?.externalKey ?? '')
    }
  }, [open])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    await onSubmit({ key, label, description, type, currencyCode, externalKey })
  }

  const canSubmit = key.trim().length > 0 && label.trim().length > 0

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{isEditing ? 'Edit attribute' : 'New user attribute'}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Key — only editable when creating */}
          <div className="space-y-1.5">
            <Label htmlFor="attr-key">
              Key{' '}
              <span className="text-muted-foreground font-normal text-xs">
                (matches user.metadata field)
              </span>
            </Label>
            <Input
              id="attr-key"
              value={key}
              onChange={(e) => setKey(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_'))}
              placeholder="mrr"
              disabled={isEditing}
              className={isEditing ? 'bg-muted text-muted-foreground' : ''}
              required
            />
            {!isEditing && (
              <p className="text-[11px] text-muted-foreground">
                Lowercase letters, numbers, underscores only. Cannot be changed after creation.
              </p>
            )}
          </div>

          {/* Label */}
          <div className="space-y-1.5">
            <Label htmlFor="attr-label">Display label</Label>
            <Input
              id="attr-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Monthly Revenue"
              required
            />
          </div>

          {/* Type */}
          <div className="space-y-1.5">
            <Label>Type</Label>
            <Select value={type} onValueChange={(v) => setType(v as AttributeType)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ATTRIBUTE_TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Currency code — only for currency type */}
          {type === 'currency' && (
            <div className="space-y-1.5">
              <Label>Currency</Label>
              <Select value={currencyCode} onValueChange={setCurrencyCode}>
                <SelectTrigger className="w-[120px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CURRENCY_CODES.map((code) => (
                    <SelectItem key={code} value={code}>
                      {code}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Description */}
          <div className="space-y-1.5">
            <Label htmlFor="attr-desc">
              Description <span className="text-muted-foreground font-normal">(optional)</span>
            </Label>
            <Textarea
              id="attr-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Monthly recurring revenue in USD"
              rows={2}
              className="resize-none text-sm"
            />
          </div>

          {/* External key — CDP trait name mapping */}
          <div className="space-y-1.5">
            <Label htmlFor="attr-external-key">
              CDP trait name{' '}
              <span className="text-muted-foreground font-normal text-xs">(optional)</span>
            </Label>
            <Input
              id="attr-external-key"
              value={externalKey}
              onChange={(e) => setExternalKey(e.target.value)}
              placeholder="monthly_recurring_revenue"
            />
            <p className="text-[11px] text-muted-foreground">
              Maps an external trait name (e.g. from Segment) to this attribute&apos;s internal key.
              Leave blank to use the key above.
            </p>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!canSubmit || isPending}>
              {isPending ? 'Saving...' : isEditing ? 'Save changes' : 'Create attribute'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ============================================
// Attribute row
// ============================================

function AttributeRow({
  attribute,
  onEdit,
  onDelete,
}: {
  attribute: UserAttributeItem
  onEdit: () => void
  onDelete: () => void
}) {
  const typeInfo = ATTRIBUTE_TYPES.find((t) => t.value === attribute.type)
  const badgeClass = TYPE_BADGE_COLORS[attribute.type as AttributeType] ?? ''

  return (
    <div className="flex items-center gap-4 py-3 border-b border-border/30 last:border-0">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-sm text-foreground">{attribute.label}</span>
          <code className="text-[11px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded font-mono">
            {attribute.key}
          </code>
          <span
            className={`inline-flex items-center text-[10px] font-medium px-1.5 py-0.5 rounded border ${badgeClass}`}
          >
            {typeInfo?.label ?? attribute.type}
            {attribute.type === 'currency' && attribute.currencyCode
              ? ` · ${attribute.currencyCode}`
              : ''}
          </span>
        </div>
        {attribute.description && (
          <p className="text-xs text-muted-foreground mt-0.5 truncate">{attribute.description}</p>
        )}
      </div>

      <div className="flex items-center gap-1 shrink-0">
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-muted-foreground hover:text-foreground"
          onClick={onEdit}
          title="Edit attribute"
        >
          <PencilIcon className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-muted-foreground hover:text-destructive"
          onClick={onDelete}
          title="Delete attribute"
        >
          <TrashIcon className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  )
}

// ============================================
// Main component
// ============================================

interface UserAttributesListProps {
  initialAttributes: UserAttributeItem[]
}

export function UserAttributesList({ initialAttributes }: UserAttributesListProps) {
  const createAttr = useCreateUserAttribute()
  const updateAttr = useUpdateUserAttribute()
  const deleteAttr = useDeleteUserAttribute()

  const [attributes, setAttributes] = useState(initialAttributes)
  const [createOpen, setCreateOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<UserAttributeItem | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<UserAttributeItem | null>(null)

  // Sync server mutations back to local state
  const handleCreate = async (values: AttributeFormValues) => {
    const created = await createAttr.mutateAsync({
      key: values.key,
      label: values.label,
      description: values.description || undefined,
      type: values.type,
      currencyCode:
        values.type === 'currency'
          ? (values.currencyCode as Parameters<typeof createAttr.mutateAsync>[0]['currencyCode'])
          : undefined,
      externalKey: values.externalKey || null,
    })
    setAttributes((prev) => [...prev, created].sort((a, b) => a.label.localeCompare(b.label)))
    setCreateOpen(false)
  }

  const handleUpdate = async (values: AttributeFormValues) => {
    if (!editTarget) return
    const updated = await updateAttr.mutateAsync({
      id: editTarget.id as UserAttributeId,
      label: values.label,
      description: values.description || null,
      type: values.type,
      currencyCode:
        values.type === 'currency'
          ? (values.currencyCode as Parameters<typeof updateAttr.mutateAsync>[0]['currencyCode'])
          : null,
      externalKey: values.externalKey || null,
    })
    setAttributes((prev) =>
      prev
        .map((a) => (a.id === updated.id ? updated : a))
        .sort((a, b) => a.label.localeCompare(b.label))
    )
    setEditTarget(null)
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    await deleteAttr.mutateAsync(deleteTarget.id as UserAttributeId)
    setAttributes((prev) => prev.filter((a) => a.id !== deleteTarget.id))
    setDeleteTarget(null)
  }

  return (
    <SettingsCard
      title="User Attributes"
      description="Define custom attributes that map to fields in user metadata. These appear as segment rule options."
      action={
        <Button size="sm" className="h-8 text-xs gap-1.5" onClick={() => setCreateOpen(true)}>
          <PlusIcon className="h-3.5 w-3.5" />
          New attribute
        </Button>
      }
    >
      {attributes.length === 0 ? (
        <EmptyState
          icon={AdjustmentsHorizontalIcon}
          title="No attributes yet"
          description="Add custom user attributes to enable richer segmentation rules."
          action={
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <PlusIcon className="h-4 w-4 mr-1.5" />
              New attribute
            </Button>
          }
          className="py-10"
        />
      ) : (
        <div className="divide-y divide-border/30">
          {attributes.map((attr) => (
            <AttributeRow
              key={attr.id}
              attribute={attr}
              onEdit={() => setEditTarget(attr)}
              onDelete={() => setDeleteTarget(attr)}
            />
          ))}
        </div>
      )}

      {/* Create dialog */}
      <AttributeFormDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSubmit={handleCreate}
        isPending={createAttr.isPending}
      />

      {/* Edit dialog */}
      <AttributeFormDialog
        open={!!editTarget}
        onOpenChange={(open) => !open && setEditTarget(null)}
        initialValues={
          editTarget
            ? {
                id: editTarget.id as UserAttributeId,
                key: editTarget.key,
                label: editTarget.label,
                description: editTarget.description ?? '',
                type: editTarget.type as AttributeType,
                currencyCode: editTarget.currencyCode ?? 'USD',
                externalKey: editTarget.externalKey ?? '',
              }
            : undefined
        }
        onSubmit={handleUpdate}
        isPending={updateAttr.isPending}
      />

      {/* Delete confirm */}
      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={`Delete "${deleteTarget?.label}"?`}
        description="This will remove the attribute definition. Existing segment rules using this attribute key will continue to work but won't show the friendly label."
        confirmLabel="Delete"
        variant="destructive"
        isPending={deleteAttr.isPending}
        onConfirm={handleDelete}
      />
    </SettingsCard>
  )
}
