// @vitest-environment happy-dom
/**
 * The words a shared part shows when its caller passes none (a missing name,
 * a default placeholder, an unlabelled button) read in the teammate's
 * language, and stay as they were in English.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { IntlProvider } from 'react-intl'
import de from '@/locales/de.json'
import { FilterAddButton } from '@/components/shared/filter-chip'
import { ListItemRemoveButton } from '@/components/shared/sidebar-primitives'
import { SearchInput } from '@/components/shared/search-input'
import { SortMenu } from '@/components/shared/sort-menu'
import { Autocomplete } from '@/components/ui/autocomplete'

afterEach(cleanup)

function parts() {
  return (
    <>
      <FilterAddButton />
      <ListItemRemoveButton onClick={() => {}} />
      <SearchInput value="" onChange={() => {}} />
      <SortMenu options={[{ value: 'new', label: 'Neueste' }]} value="new" onChange={() => {}} />
      <Autocomplete value="" onValueChange={() => {}} suggestions={[]} />
    </>
  )
}

describe('shared parts without caller words', () => {
  it('read German on a German page', () => {
    render(
      <IntlProvider locale="de" messages={de}>
        {parts()}
      </IntlProvider>
    )
    expect(screen.getByRole('button', { name: 'Filtern' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Entfernen' })).toBeTruthy()
    expect(screen.getByPlaceholderText('Suchen …')).toBeTruthy()
    expect(screen.getByText('Sortieren: Neueste')).toBeTruthy()
    expect(screen.getByText('Auswählen …')).toBeTruthy()
  })

  it('keep their English outside a provider', () => {
    render(parts())
    expect(screen.getByRole('button', { name: 'Filter' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Remove' })).toBeTruthy()
    expect(screen.getByPlaceholderText('Search...')).toBeTruthy()
    expect(screen.getByText('Sort: Neueste')).toBeTruthy()
    expect(screen.getByText('Select…')).toBeTruthy()
  })
})
