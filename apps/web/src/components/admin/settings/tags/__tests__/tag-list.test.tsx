// @vitest-environment happy-dom
/**
 * Tag settings — create/edit dialog and portal visibility.
 *
 * The dialog defaults new tags to Portal, mirrors the saved flag when
 * editing, and sends `isPublic` on save. Internal tags are marked in the
 * list so the state is visible without opening the dialog.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { IntlProvider } from 'react-intl'
import type { ReactNode } from 'react'
import type { PostTag } from '@/lib/shared/db-types'

const mockCreate = vi.fn()
const mockUpdate = vi.fn()
vi.mock('@/lib/server/functions/post-tags', () => ({
  createPostTagFn: (...args: unknown[]) => mockCreate(...args),
  updatePostTagFn: (...args: unknown[]) => mockUpdate(...args),
  deletePostTagFn: vi.fn(),
}))

vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({ invalidate: vi.fn() }),
  Link: ({ to, children, className }: { to: string; children: ReactNode; className?: string }) => (
    <a href={to} className={className}>
      {children}
    </a>
  ),
}))

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import { TagsSettingsPage } from '../tag-list'

function TagList({ initialTags }: { initialTags: PostTag[] }) {
  return (
    <IntlProvider locale="en" defaultLocale="en">
      <QueryClientProvider client={new QueryClient()}>
        <TagsSettingsPage initialTags={initialTags} boards={[]} />
      </QueryClientProvider>
    </IntlProvider>
  )
}

const PUBLIC_TAG = {
  id: 'post_tag_public',
  name: 'Bug',
  color: '#ef4444',
  description: 'Broken behaviour',
  aiPrompt: null,
  isPublic: true,
  createdAt: new Date('2026-01-01'),
  deletedAt: null,
} as PostTag

const INTERNAL_TAG = {
  ...PUBLIC_TAG,
  id: 'post_tag_internal',
  name: 'Churn risk',
  description: null,
  isPublic: false,
} as PostTag

beforeEach(() => {
  vi.clearAllMocks()
  mockCreate.mockImplementation(async ({ data }) => ({
    ...PUBLIC_TAG,
    id: 'post_tag_new',
    ...data,
  }))
  mockUpdate.mockImplementation(async ({ data }) => ({ ...PUBLIC_TAG, ...data }))
})

function portalRadio() {
  return screen.getByRole('radio', { name: /^portal$/i })
}

function internalRadio() {
  return screen.getByRole('radio', { name: /^internal$/i })
}

describe('<TagList> — portal visibility', () => {
  it('shows the full tag name and marks only internal tags', () => {
    render(<TagList initialTags={[PUBLIC_TAG, INTERNAL_TAG]} />)

    expect(screen.getByText('Bug')).toBeTruthy()
    expect(screen.getByText('Churn risk')).toBeTruthy()
    expect(screen.getAllByText('Internal')).toHaveLength(1)
    expect(screen.queryByText('Portal')).toBeNull()
    const internalRow = screen.getByText('Churn risk').closest('[data-slot="settings-list-row"]')!
    expect(within(internalRow as HTMLElement).getByText('Internal')).toBeTruthy()
  })

  it('is the Tags page with no breadcrumb of its own, and has a single card with no header', () => {
    render(<TagList initialTags={[PUBLIC_TAG]} />)
    expect(screen.getByRole('heading', { level: 1, name: 'Tags' })).toBeTruthy()
    // The settings layout titles it with its module and shows the module's tabs.
    expect(screen.queryByRole('navigation', { name: 'Breadcrumb' })).toBeNull()
    expect(screen.queryByRole('heading', { level: 2, name: 'Tags' })).toBeNull()
    expect(screen.queryByText('Add new tag')).toBeNull()
  })

  it('shows an empty state with a New tag action when there are no tags', () => {
    render(<TagList initialTags={[]} />)
    expect(screen.getByText('No tags yet')).toBeTruthy()
    expect(screen.getAllByRole('button', { name: /^new tag$/i })).toHaveLength(1)
  })

  it('defaults a new tag to public and sends isPublic on create', async () => {
    render(<TagList initialTags={[]} />)

    fireEvent.click(screen.getByRole('button', { name: /^new tag$/i }))
    expect(portalRadio()).toHaveAttribute('aria-checked', 'true')
    expect(internalRadio()).toHaveAttribute('aria-checked', 'false')

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Design' } })
    fireEvent.click(screen.getByRole('button', { name: /create tag/i }))

    await waitFor(() =>
      expect(mockCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({ name: 'Design', isPublic: true }),
      })
    )
  })

  it('lets an admin create an internal tag by choosing Internal', async () => {
    render(<TagList initialTags={[]} />)

    fireEvent.click(screen.getByRole('button', { name: /^new tag$/i }))
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Churn risk' } })
    fireEvent.click(internalRadio())
    expect(internalRadio()).toHaveAttribute('aria-checked', 'true')
    expect(portalRadio()).toHaveAttribute('aria-checked', 'false')

    fireEvent.click(screen.getByRole('button', { name: /create tag/i }))

    await waitFor(() =>
      expect(mockCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({ name: 'Churn risk', isPublic: false }),
      })
    )
  })

  it('reflects the saved flag when editing and sends the toggled value', async () => {
    render(<TagList initialTags={[INTERNAL_TAG]} />)

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Actions for Churn risk' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Edit' }))
    expect(internalRadio()).toHaveAttribute('aria-checked', 'true')

    fireEvent.click(portalRadio())
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }))

    await waitFor(() =>
      expect(mockUpdate).toHaveBeenCalledWith({
        data: expect.objectContaining({ id: 'post_tag_internal', isPublic: true }),
      })
    )
  })
})

describe('<TagList> — create dialog layout', () => {
  it('keeps Create tag disabled until a name is entered', () => {
    render(<TagList initialTags={[]} />)

    fireEvent.click(screen.getByRole('button', { name: /^new tag$/i }))
    expect(screen.getByRole('button', { name: /create tag/i })).toBeDisabled()

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Design' } })
    expect(screen.getByRole('button', { name: /create tag/i })).toBeEnabled()
  })

  it('does not leak the PostTag type name as a placeholder', () => {
    render(<TagList initialTags={[]} />)

    fireEvent.click(screen.getByRole('button', { name: /^new tag$/i }))
    expect(screen.queryByText('PostTag name')).toBeNull()
  })

  it('opens the color palette from a single swatch', () => {
    render(<TagList initialTags={[]} />)

    fireEvent.click(screen.getByRole('button', { name: /^new tag$/i }))
    fireEvent.click(screen.getByRole('button', { name: /^color$/i }))
    expect(screen.getByPlaceholderText('#000000')).toBeTruthy()
  })
})

describe('<TagList> row menu', () => {
  it('confirms a delete with Delete tag', async () => {
    const user = userEvent.setup()
    render(<TagList initialTags={[PUBLIC_TAG]} />)
    await user.click(screen.getByRole('button', { name: 'Actions for Bug' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }))
    const dialog = screen.getByRole('alertdialog')
    expect(within(dialog).getByText('Delete tag?')).toBeTruthy()
    expect(within(dialog).getByRole('button', { name: 'Delete tag' })).toBeTruthy()
  })
})
