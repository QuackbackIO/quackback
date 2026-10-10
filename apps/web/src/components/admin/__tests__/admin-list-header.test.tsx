// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AdminListHeader } from '../admin-list-header'

afterEach(cleanup)

const sortOptions = [
  { value: 'newest', label: 'Newest' },
  { value: 'oldest', label: 'Oldest' },
]

describe('AdminListHeader', () => {
  it('renders the search input and forwards changes', () => {
    const onSearchChange = vi.fn()
    render(<AdminListHeader searchValue="" onSearchChange={onSearchChange} />)
    fireEvent.change(screen.getByPlaceholderText('Search...'), { target: { value: 'abc' } })
    expect(onSearchChange).toHaveBeenCalledWith('abc')
  })

  it('wraps its controls so none scroll off a narrow screen', () => {
    render(
      <AdminListHeader searchValue="" onSearchChange={() => {}} action={<button>New</button>} />
    )
    const row = document.querySelector('[data-slot="admin-list-search"]')!.parentElement!
    expect(row.className).toContain('flex-wrap')
  })

  it('gives the search input an accessible name', () => {
    render(<AdminListHeader searchValue="" onSearchChange={() => {}} />)
    expect(screen.getByRole('textbox', { name: 'Search...' })).toBeTruthy()
  })

  it('caps the search width at 360px', () => {
    render(<AdminListHeader searchValue="" onSearchChange={() => {}} />)
    const wrap = document.querySelector('[data-slot="admin-list-search"]')
    expect(wrap?.className).toContain('max-w-[360px]')
  })

  it('renders no sort control for an empty option list', () => {
    render(
      <AdminListHeader
        searchValue=""
        onSearchChange={() => {}}
        sortOptions={[]}
        onSortChange={() => {}}
      />
    )
    expect(screen.queryByRole('button', { name: /Sort/ })).toBeNull()
  })

  it('renders sort as a menu, not inline pills', async () => {
    const user = userEvent.setup()
    const onSortChange = vi.fn()
    render(
      <AdminListHeader
        searchValue=""
        onSearchChange={() => {}}
        sortOptions={sortOptions}
        activeSort="newest"
        onSortChange={onSortChange}
      />
    )
    expect(screen.queryByRole('button', { name: 'Oldest' })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Sort: Newest' }))
    await user.click(screen.getByRole('menuitemradio', { name: 'Oldest' }))
    expect(onSortChange).toHaveBeenCalledWith('oldest')
  })

  it('places filters between sort and the action', () => {
    render(
      <AdminListHeader
        searchValue=""
        onSearchChange={() => {}}
        sortOptions={sortOptions}
        activeSort="newest"
        onSortChange={() => {}}
        filters={<button>Filter</button>}
        action={<button>New post</button>}
      />
    )
    const buttons = screen
      .getAllByRole('button')
      .map((b) => b.textContent?.trim())
      .filter(Boolean)
    expect(buttons.indexOf('Sort: Newest')).toBeLessThan(buttons.indexOf('Filter'))
    expect(buttons.indexOf('Filter')).toBeLessThan(buttons.indexOf('New post'))
  })

  it('renders children below the bar', () => {
    render(
      <AdminListHeader searchValue="" onSearchChange={() => {}}>
        <div>active filters</div>
      </AdminListHeader>
    )
    expect(screen.getByText('active filters')).toBeTruthy()
  })
})
