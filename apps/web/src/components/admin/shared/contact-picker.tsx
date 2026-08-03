/**
 * `<ContactPicker />` — single contact picker with cross-org search.
 */
import { useState } from 'react'
import type { ContactId } from '@quackback/ids'
import { useContactSearch } from '@/lib/client/hooks/use-orgs-contacts-queries'
import { ResourcePicker } from './resource-picker'

interface Props {
  value: ContactId | null
  onValueChange: (value: ContactId | null) => void
  placeholder?: string
  className?: string
  disabled?: boolean
  allowClear?: boolean
}

export function ContactPicker(props: Props) {
  const [query, setQuery] = useState('')
  const { data: contacts = [], isLoading } = useContactSearch(query, query.length > 0)
  const options = contacts.map((c) => ({
    id: c.id as ContactId,
    label: c.name ?? c.email ?? c.id,
    description: c.email ?? undefined,
  }))
  return (
    <ResourcePicker<ContactId>
      value={props.value}
      onValueChange={props.onValueChange}
      options={options}
      isLoading={isLoading}
      placeholder={props.placeholder ?? 'Select contact…'}
      searchPlaceholder="Search by name or email…"
      emptyMessage={
        query.length === 0 ? 'Type to search…' : isLoading ? 'Searching…' : 'No matches.'
      }
      disabled={props.disabled}
      className={props.className}
      allowClear={props.allowClear}
      onSearchChange={setQuery}
    />
  )
}
