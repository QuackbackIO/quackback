// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const tags = [
  { id: 'tag_1', name: 'Billing', color: '#ff0000', count: 3, archived: false },
  { id: 'tag_2', name: 'Old', color: '#00ff00', count: 1, archived: true },
]

const restoreFn = vi.fn(async () => undefined)
const deleteFn = vi.fn(async () => undefined)

vi.mock('@/lib/server/functions/conversation-tags', () => ({
  listConversationTagsForSettingsFn: vi.fn(async () => tags),
  updateConversationTagFn: vi.fn(),
  deleteConversationTagFn: deleteFn,
  restoreConversationTagFn: restoreFn,
  hardDeleteConversationTagFn: vi.fn(),
}))
vi.mock('@tanstack/react-router', async () => {
  const actual =
    await vi.importActual<typeof import('@tanstack/react-router')>('@tanstack/react-router')
  return {
    ...actual,
    Link: ({ children, to, ...rest }: { children: React.ReactNode; to: string }) => (
      <a href={to} {...rest}>
        {children}
      </a>
    ),
  }
})

const { ConversationTagsManager } = await import('../conversation-tags-manager')

afterEach(cleanup)

function renderManager() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <ConversationTagsManager />
    </QueryClientProvider>
  )
}

describe('ConversationTagsManager rows', () => {
  it('keeps edit and archive in a row menu instead of always-visible icons', async () => {
    const user = userEvent.setup()
    renderManager()
    await screen.findByText('Billing')
    expect(screen.queryByTitle('Edit tag')).toBeNull()
    expect(screen.queryByTitle('Archive tag')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Actions for Billing' }))
    expect(await screen.findByRole('menuitem', { name: 'Edit' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Archive' })).toBeInTheDocument()
  })

  it('opens the archive confirmation from the menu', async () => {
    const user = userEvent.setup()
    renderManager()
    await screen.findByText('Billing')
    await user.click(screen.getByRole('button', { name: 'Actions for Billing' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Archive' }))
    expect(await screen.findByText('Archive "Billing"?')).toBeInTheDocument()
  })

  it('offers Restore and Delete on an archived tag', async () => {
    const user = userEvent.setup()
    renderManager()
    await screen.findByText('Old')
    await user.click(screen.getByRole('button', { name: 'Actions for Old' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Restore' }))
    expect(restoreFn).toHaveBeenCalledWith({ data: { id: 'tag_2' } })
  })

  it('links the usage count to the filtered inbox', async () => {
    renderManager()
    const link = await screen.findByRole('link', { name: /3 conversations/ })
    expect(link).toHaveAttribute('href', '/admin/inbox')
  })
})
