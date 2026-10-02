'use client'

import {
  useCreateCompanyAttribute,
  useUpdateCompanyAttribute,
  useDeleteCompanyAttribute,
} from '@/lib/client/mutations'
import type { CompanyAttributeItem } from '@/lib/client/hooks/use-company-attributes-queries'
import type { CompanyAttributeId } from '@quackback/ids'
import {
  ScalarAttributeList,
  type BuiltinAttributeField,
  type CurrencyCode,
  type ScalarAttributeCopy,
} from '@/components/admin/settings/scalar-attribute-list'

/** The standard company columns, listed for discoverability beside the custom rows. */
const COMPANY_STANDARD_FIELDS: BuiltinAttributeField[] = [
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

const COPY: ScalarAttributeCopy = {
  createTitle: 'New company attribute',
  keyHint: 'matches a field in company custom attributes',
  keyPlaceholder: 'contract_value',
  labelPlaceholder: 'Contract value',
  descriptionPlaceholder: 'Annual contract value in USD',
  externalSystem: 'CRM',
  externalPlaceholder: 'annual_contract_value',
  externalHint:
    "Maps an external attribute name to this attribute's internal key. Leave blank to use the key above.",
  deleteDescription:
    'This removes the attribute definition. Existing values on companies are kept but lose their friendly label.',
}

interface CompanyAttributesListProps {
  initialAttributes: CompanyAttributeItem[]
}

export function CompanyAttributesList({ initialAttributes }: CompanyAttributesListProps) {
  const createAttr = useCreateCompanyAttribute()
  const updateAttr = useUpdateCompanyAttribute()
  const deleteAttr = useDeleteCompanyAttribute()

  return (
    <ScalarAttributeList
      initialAttributes={initialAttributes}
      builtinFields={COMPANY_STANDARD_FIELDS}
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
          id: id as CompanyAttributeId,
          label: values.label,
          description: values.description || null,
          type: values.type,
          currencyCode: values.type === 'currency' ? (values.currencyCode as CurrencyCode) : null,
          externalKey: values.externalKey || null,
        })
      }
      onDelete={(id) => deleteAttr.mutateAsync(id as CompanyAttributeId)}
    />
  )
}
