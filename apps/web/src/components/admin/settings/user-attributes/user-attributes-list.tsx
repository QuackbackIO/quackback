'use client'

import {
  useCreateUserAttribute,
  useUpdateUserAttribute,
  useDeleteUserAttribute,
} from '@/lib/client/mutations'
import type { UserAttributeItem } from '@/lib/client/hooks/use-user-attributes-queries'
import type { UserAttributeId } from '@quackback/ids'
import { BUILTIN_FIELDS } from '@/lib/shared/segment-builtin-fields'
import {
  ScalarAttributeList,
  type CurrencyCode,
  type ScalarAttributeCopy,
} from '@/components/admin/settings/scalar-attribute-list'

const COPY: ScalarAttributeCopy = {
  createTitle: 'New user attribute',
  keyHint: 'matches user.metadata field',
  keyPlaceholder: 'mrr',
  labelPlaceholder: 'Monthly revenue',
  descriptionPlaceholder: 'Monthly recurring revenue in USD',
  externalSystem: 'CDP',
  externalPlaceholder: 'monthly_recurring_revenue',
  externalHint:
    "Maps an external attribute name to this attribute's internal key. Leave blank to use the key above.",
  deleteDescription:
    "This removes the attribute definition. Existing segment rules using this attribute key keep working but won't show the friendly label.",
}

const USER_BUILTIN_FIELDS = BUILTIN_FIELDS.filter((f) => f.group === 'attribute')

interface UserAttributesListProps {
  initialAttributes: UserAttributeItem[]
}

export function UserAttributesList({ initialAttributes }: UserAttributesListProps) {
  const createAttr = useCreateUserAttribute()
  const updateAttr = useUpdateUserAttribute()
  const deleteAttr = useDeleteUserAttribute()

  return (
    <ScalarAttributeList
      initialAttributes={initialAttributes}
      builtinFields={USER_BUILTIN_FIELDS}
      copy={COPY}
      isCreating={createAttr.isPending}
      isUpdating={updateAttr.isPending}
      isDeleting={deleteAttr.isPending}
      onCreate={(values) =>
        createAttr.mutateAsync({
          key: values.key,
          label: values.label,
          description: values.description || undefined,
          type: values.type,
          currencyCode:
            values.type === 'currency' ? (values.currencyCode as CurrencyCode) : undefined,
          externalKey: values.externalKey || null,
        })
      }
      onUpdate={(id, values) =>
        updateAttr.mutateAsync({
          id: id as UserAttributeId,
          label: values.label,
          description: values.description || null,
          type: values.type,
          currencyCode: values.type === 'currency' ? (values.currencyCode as CurrencyCode) : null,
          externalKey: values.externalKey || null,
        })
      }
      onDelete={(id) => deleteAttr.mutateAsync(id as UserAttributeId)}
    />
  )
}
