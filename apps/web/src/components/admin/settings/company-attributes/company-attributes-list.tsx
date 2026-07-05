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
import { SettingsCard } from '@/components/admin/settings/settings-card'
import {
  useCreateCompanyAttribute,
  useUpdateCompanyAttribute,
  useDeleteCompanyAttribute,
} from '@/lib/client/mutations'
import type { CompanyAttributeItem } from '@/lib/client/hooks/use-company-attributes-queries'
import type { CompanyAttributeId } from '@quackback/ids'

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
  string: 'bg-blue-500/10 text-blue-500 border-blue-500/20',
  number: 'bg-green-500/10 text-green-500 border-green-500/20',
  boolean: 'bg-purple-500/10 text-purple-500 border-purple-500/20',
  date: 'bg-orange-500/10 text-orange-500 border-orange-500/20',
  currency: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20',
}

/** The standard company columns, listed for discoverability beside the custom rows. */
const COMPANY_STANDARD_FIELDS: {
  key: string
  label: string
  type: AttributeType
  description: string
}[] = [
  { key: 'name', label: 'Name', type: 'string', description: 'The company name.' },
  {
    key: 'domain',
    label: 'Email domain',
    type: 'string',
    description: 'The email domain that identifies this company (unique).',
  },
  {
    key: 'plan',
    label: 'Plan',
    type: 'string',
    description: 'Free-text plan label shown in the agent sidebar.',
  },
  {
    key: 'mrr',
    label: 'Monthly spend',
    type: 'number',
    description: 'Monthly recurring revenue, stored in cents and shown as currency.',
  },
  { key: 'size', label: 'Size', type: 'string', description: 'Company size, e.g. "11-50".' },
  { key: 'website', label: 'Website', type: 'string', description: 'The company website URL.' },
  {
    key: 'industry',
    label: 'Industry',
    type: 'string',
    description: 'The industry the company operates in.',
  },
]

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
  initialValues?: Partial<AttributeFormValues> & { id?: CompanyAttributeId }
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
          <DialogTitle>{isEditing ? 'Edit attribute' : 'New company attribute'}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Key — only editable when creating */}
          <div className="space-y-1.5">
            <Label htmlFor="company-attr-key">
              Key{' '}
              <span className="text-muted-foreground font-normal text-xs">
                (matches a field in company custom attributes)
              </span>
            </Label>
            <Input
              id="company-attr-key"
              value={key}
              onChange={(e) => setKey(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_'))}
              placeholder="contract_value"
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
            <Label htmlFor="company-attr-label">Display label</Label>
            <Input
              id="company-attr-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Contract value"
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
            <Label htmlFor="company-attr-desc">
              Description <span className="text-muted-foreground font-normal">(optional)</span>
            </Label>
            <Textarea
              id="company-attr-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Annual contract value in USD"
              rows={2}
              className="resize-none text-sm"
            />
          </div>

          {/* External key — CRM attribute name mapping */}
          <div className="space-y-1.5">
            <Label htmlFor="company-attr-external-key">
              CRM attribute name{' '}
              <span className="text-muted-foreground font-normal text-xs">(optional)</span>
            </Label>
            <Input
              id="company-attr-external-key"
              value={externalKey}
              onChange={(e) => setExternalKey(e.target.value)}
              placeholder="annual_contract_value"
            />
            <p className="text-[11px] text-muted-foreground">
              Maps an external attribute name to this attribute&apos;s internal key. Leave blank to
              use the key above.
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

function AttributeRow({
  attribute,
  onEdit,
  onDelete,
}: {
  attribute: CompanyAttributeItem
  onEdit: () => void
  onDelete: () => void
}) {
  const typeInfo = ATTRIBUTE_TYPES.find((t) => t.value === attribute.type)
  const badgeClass = TYPE_BADGE_COLORS[attribute.type as AttributeType] ?? ''

  return (
    <div className="flex items-center gap-4 py-3 border-b border-border/50 last:border-0">
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

function StandardFieldRow({ field }: { field: (typeof COMPANY_STANDARD_FIELDS)[number] }) {
  const badgeClass = TYPE_BADGE_COLORS[field.type] ?? ''
  const typeLabel = ATTRIBUTE_TYPES.find((t) => t.value === field.type)?.label ?? field.type

  return (
    <div className="flex items-center gap-4 py-3 border-b border-border/50 last:border-0">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-sm text-foreground">{field.label}</span>
          <code className="text-[11px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded font-mono">
            {field.key}
          </code>
          <span
            className={`inline-flex items-center text-[10px] font-medium px-1.5 py-0.5 rounded border ${badgeClass}`}
          >
            {typeLabel}
          </span>
        </div>
        <p className="text-xs text-muted-foreground mt-0.5 truncate">{field.description}</p>
      </div>

      <span className="text-xs text-muted-foreground shrink-0 pr-2">Built-in</span>
    </div>
  )
}

interface CompanyAttributesListProps {
  initialAttributes: CompanyAttributeItem[]
}

export function CompanyAttributesList({ initialAttributes }: CompanyAttributesListProps) {
  const createAttr = useCreateCompanyAttribute()
  const updateAttr = useUpdateCompanyAttribute()
  const deleteAttr = useDeleteCompanyAttribute()

  const [attributes, setAttributes] = useState(initialAttributes)
  const [createOpen, setCreateOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<CompanyAttributeItem | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<CompanyAttributeItem | null>(null)

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
      id: editTarget.id as CompanyAttributeId,
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
    await deleteAttr.mutateAsync(deleteTarget.id as CompanyAttributeId)
    setAttributes((prev) => prev.filter((a) => a.id !== deleteTarget.id))
    setDeleteTarget(null)
  }

  return (
    <SettingsCard
      title="Company attributes"
      description="Define custom attributes for companies. These appear on company profiles and as company predicates in segment rules."
      action={
        <Button size="sm" className="h-8 text-xs gap-1.5" onClick={() => setCreateOpen(true)}>
          <PlusIcon className="h-3.5 w-3.5" />
          New attribute
        </Button>
      }
    >
      {/* Standard + custom rows share one container so they read as a single
       *  continuous list; the per-row 'Built-in' badge is the only marker
       *  separating the two groups (mirrors the person attributes card). */}
      <div>
        {COMPANY_STANDARD_FIELDS.map((field) => (
          <StandardFieldRow key={field.key} field={field} />
        ))}
        {attributes.map((attr) => (
          <AttributeRow
            key={attr.id}
            attribute={attr}
            onEdit={() => setEditTarget(attr)}
            onDelete={() => setDeleteTarget(attr)}
          />
        ))}
      </div>

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
                id: editTarget.id as CompanyAttributeId,
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
        description="This will remove the attribute definition. Existing values on companies are kept but lose their friendly label."
        confirmLabel="Delete"
        variant="destructive"
        isPending={deleteAttr.isPending}
        onConfirm={handleDelete}
      />
    </SettingsCard>
  )
}
