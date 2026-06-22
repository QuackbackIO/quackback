/**
 * `<OrgPicker />` — single organization picker with type-ahead.
 */
import { useState } from 'react'
import type { OrganizationId } from '@quackback/ids'
import { useOrganizations } from '@/lib/client/hooks/use-orgs-contacts-queries'
import { ResourcePicker } from './resource-picker'

interface Props {
  value: OrganizationId | null
  onValueChange: (value: OrganizationId | null) => void
  placeholder?: string
  className?: string
  disabled?: boolean
  allowClear?: boolean
}

export function OrgPicker(props: Props) {
  const [query, setQuery] = useState('')
  const { data: orgs = [], isLoading } = useOrganizations({ query: query || undefined })
  const options = orgs.map((o) => ({
    id: o.id as OrganizationId,
    label: o.name,
    description: o.domain ?? undefined,
  }))
  return (
    <ResourcePicker<OrganizationId>
      value={props.value}
      onValueChange={props.onValueChange}
      options={options}
      isLoading={isLoading}
      placeholder={props.placeholder ?? 'Select organization…'}
      searchPlaceholder="Search organizations…"
      emptyMessage={isLoading ? 'Searching…' : 'No matches.'}
      disabled={props.disabled}
      className={props.className}
      allowClear={props.allowClear}
      onSearchChange={setQuery}
    />
  )
}
