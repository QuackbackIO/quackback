// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { WidgetHomeCard } from '@/lib/shared/types/settings'

const { HomeCardsList } = await import('../home-cards-list')

afterEach(cleanup)

const cards: WidgetHomeCard[] = [
  { id: 'feedback', type: 'feedback' },
  { id: 'new-conversation', type: 'new_conversation', enabled: false },
  { id: 'link-1', type: 'link', title: 'Pricing', url: 'https://example.com/pricing' },
]

function setup(overrides: Partial<Parameters<typeof HomeCardsList>[0]> = {}) {
  const onChange = vi.fn()
  const user = userEvent.setup()
  render(<HomeCardsList cards={cards} onChange={onChange} {...overrides} />)
  return { onChange, user }
}

describe('HomeCardsList', () => {
  it('renders compact rows with no inline editor fields', () => {
    setup()
    expect(screen.getByText('Pricing')).toBeInTheDocument()
    expect(screen.getByText('Feedback')).toBeInTheDocument()
    expect(screen.queryByPlaceholderText('Title (default)')).toBeNull()
    expect(screen.queryByRole('textbox')).toBeNull()
  })

  it('shows a drag grip per row', () => {
    setup()
    expect(screen.getAllByRole('button', { name: /^Reorder / })).toHaveLength(3)
  })

  it('opens the editor from the row menu and saves every field of a link card', async () => {
    const { onChange, user } = setup()
    await user.click(screen.getByRole('button', { name: 'Actions for Pricing' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Edit' }))

    const dialog = await screen.findByRole('dialog')
    const title = within(dialog).getByLabelText('Title')
    const subtitle = within(dialog).getByLabelText('Subtitle')
    const url = within(dialog).getByLabelText('URL')
    expect(title).toHaveValue('Pricing')
    expect(url).toHaveValue('https://example.com/pricing')
    expect(within(dialog).getByLabelText('Audience')).toBeInTheDocument()

    await user.clear(title)
    await user.type(title, 'Plans')
    await user.type(subtitle, 'Compare plans')
    await user.clear(url)
    await user.type(url, 'https://example.com/plans')
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }))

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith([
      cards[0],
      cards[1],
      {
        id: 'link-1',
        type: 'link',
        title: 'Plans',
        subtitle: 'Compare plans',
        url: 'https://example.com/plans',
      },
    ])
  })

  it('stores an emptied title as unset so the default copy applies', async () => {
    const { onChange, user } = setup()
    await user.click(screen.getByRole('button', { name: 'Actions for Pricing' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Edit' }))
    const dialog = await screen.findByRole('dialog')
    await user.clear(within(dialog).getByLabelText('Title'))
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }))
    const next = onChange.mock.calls[0][0] as WidgetHomeCard[]
    expect(next[2].title).toBeUndefined()
    expect(next[2].url).toBe('https://example.com/pricing')
  })

  it('offers no URL field for a built-in card', async () => {
    const { user } = setup()
    await user.click(screen.getByRole('button', { name: 'Actions for Feedback' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Edit' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).queryByLabelText('URL')).toBeNull()
    expect(within(dialog).getByLabelText('Title')).toBeInTheDocument()
  })

  it('does not change anything when the editor is cancelled', async () => {
    const { onChange, user } = setup()
    await user.click(screen.getByRole('button', { name: 'Actions for Pricing' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Edit' }))
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText('Title'), 'x')
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(onChange).not.toHaveBeenCalled()
  })

  it('removes a link card from the row menu and offers no remove for built-in cards', async () => {
    const { onChange, user } = setup()
    await user.click(screen.getByRole('button', { name: 'Actions for Pricing' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Remove' }))
    expect(onChange).toHaveBeenCalledWith([cards[0], cards[1]])

    cleanup()
    const second = setup()
    await second.user.click(screen.getByRole('button', { name: 'Actions for Feedback' }))
    await screen.findByRole('menuitem', { name: 'Edit' })
    expect(screen.queryByRole('menuitem', { name: 'Remove' })).toBeNull()
  })

  it('shows an Off badge on a hidden built-in card and none on a shown one', () => {
    setup()
    const rows = document.querySelectorAll('[data-slot="settings-list-row"]')
    expect(within(rows[1] as HTMLElement).getByText('Off')).toBeInTheDocument()
    expect(within(rows[0] as HTMLElement).queryByText('Off')).toBeNull()
  })

  it('shows a hidden built-in card from its row menu', async () => {
    const { onChange, user } = setup()
    await user.click(screen.getByRole('button', { name: 'Actions for New conversation' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Show' }))
    expect(onChange).toHaveBeenCalledWith([cards[0], { ...cards[1], enabled: true }, cards[2]])
  })

  it('hides a shown built-in card and offers no Hide on a link card', async () => {
    const { onChange, user } = setup()
    await user.click(screen.getByRole('button', { name: 'Actions for Feedback' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Hide' }))
    expect(onChange).toHaveBeenCalledWith([{ ...cards[0], enabled: false }, cards[1], cards[2]])

    cleanup()
    const second = setup()
    await second.user.click(screen.getByRole('button', { name: 'Actions for Pricing' }))
    await screen.findByRole('menuitem', { name: 'Edit' })
    expect(screen.queryByRole('menuitem', { name: 'Hide' })).toBeNull()
  })

  it('adds a blank link card', async () => {
    const { onChange, user } = setup()
    await user.click(screen.getByRole('button', { name: 'Add link card' }))
    const next = onChange.mock.calls[0][0] as WidgetHomeCard[]
    expect(next).toHaveLength(4)
    expect(next[3]).toMatchObject({ type: 'link', title: '', url: '' })
  })

  it('disables adding past eight cards', () => {
    const many = Array.from({ length: 8 }, (_, i) => ({
      id: `l${i}`,
      type: 'link' as const,
      title: `L${i}`,
      url: 'https://x.test',
    }))
    setup({ cards: many })
    expect(screen.getByRole('button', { name: 'Add link card' })).toBeDisabled()
  })

  it('shows a non-default audience in the row meta', () => {
    setup({ cards: [{ id: 'f', type: 'feedback', audience: 'identified' }] })
    expect(screen.getByText(/Signed-in users only/)).toBeInTheDocument()
  })
})
