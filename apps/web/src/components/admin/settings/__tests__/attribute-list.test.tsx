// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
}))

import { AttributeList, type AttributeListItem } from '../attribute-list'

afterEach(cleanup)

const BUILTIN: AttributeListItem = {
  id: 'name',
  label: 'Name',
  attrKey: 'name',
  typeLabel: 'Text',
  description: 'The display name.',
  builtin: true,
}

describe('AttributeList', () => {
  it('renders the Attributes card with label, mono key, muted type and description', () => {
    render(
      <AttributeList
        onNew={() => {}}
        items={[{ ...BUILTIN, id: 'mrr', label: 'Monthly spend', attrKey: 'mrr', builtin: false }]}
      />
    )
    expect(screen.getByRole('heading', { name: 'Attributes' })).toBeTruthy()
    expect(screen.getByText('Monthly spend')).toBeTruthy()
    expect(screen.getByText('mrr').tagName).toBe('CODE')
    expect(screen.getByText('Text')).toBeTruthy()
    expect(screen.getByText('The display name.')).toBeTruthy()
  })

  it('built-in rows show no badge and offer only a disabled Delete with a hint', async () => {
    const user = userEvent.setup()
    render(<AttributeList onNew={() => {}} items={[BUILTIN]} />)
    expect(screen.queryByText('Built-in')).toBeNull()
    await user.click(screen.getByRole('button', { name: `Actions for ${BUILTIN.label}` }))
    const del = await screen.findByRole('menuitem', { name: /Delete/ })
    expect(del.getAttribute('aria-disabled') ?? del.getAttribute('data-disabled')).not.toBeNull()
    expect(screen.getByText('Built-in attributes cannot be deleted')).toBeTruthy()
    expect(screen.queryByRole('menuitem', { name: 'Edit' })).toBeNull()
  })

  it('custom rows expose their actions through the row menu', async () => {
    const onEdit = vi.fn()
    const onDelete = vi.fn()
    const user = userEvent.setup()
    render(
      <AttributeList
        onNew={() => {}}
        items={[
          {
            ...BUILTIN,
            id: 'x',
            label: 'Plan tier',
            builtin: false,
            actions: [
              { label: 'Edit', onSelect: onEdit },
              { label: 'Delete', onSelect: onDelete, destructive: true },
            ],
          },
        ]}
      />
    )
    expect(screen.queryByText('Built-in')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Actions for Plan tier' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }))
    expect(onDelete).toHaveBeenCalledTimes(1)
    expect(onEdit).not.toHaveBeenCalled()
  })

  it('extra badges render beside the label and archived rows are dimmed', () => {
    render(
      <AttributeList
        onNew={() => {}}
        items={[{ ...BUILTIN, builtin: false, badges: <span>AI</span>, muted: true }]}
      />
    )
    const row = screen.getByText('Name').closest('[data-slot="settings-list-row"]') as HTMLElement
    expect(within(row).getByText('AI')).toBeTruthy()
    expect(row.parentElement!.className).toContain('opacity-60')
  })

  it('New attribute in the card header calls onNew', async () => {
    const onNew = vi.fn()
    const user = userEvent.setup()
    render(<AttributeList onNew={onNew} items={[BUILTIN]} />)
    await user.click(screen.getByRole('button', { name: /new attribute/i }))
    expect(onNew).toHaveBeenCalledTimes(1)
  })

  it('shows the compact empty state with a New attribute action when there are no rows', async () => {
    const onNew = vi.fn()
    const user = userEvent.setup()
    render(<AttributeList onNew={onNew} items={[]} emptyDescription="Capture structured data." />)
    expect(screen.getByText('No attributes yet')).toBeTruthy()
    expect(screen.getByText('Capture structured data.')).toBeTruthy()
    const buttons = screen.getAllByRole('button', { name: /new attribute/i })
    expect(buttons).toHaveLength(2)
    await user.click(buttons[1])
    expect(onNew).toHaveBeenCalledTimes(1)
  })
})
