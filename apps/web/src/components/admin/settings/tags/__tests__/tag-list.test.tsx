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
}))

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import { TagList } from '../tag-list'

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
  it('marks internal tags in the list and leaves public tags unmarked', () => {
    render(<TagList initialTags={[PUBLIC_TAG, INTERNAL_TAG]} />)

    const internalRow = screen.getByText('Churn risk').closest('div')!
    expect(within(internalRow).getByText('Internal')).toBeTruthy()

    const publicRow = screen.getByText('Bug').closest('div')!
    expect(within(publicRow).queryByText('Internal')).toBeNull()
  })

  it('defaults a new tag to public and sends isPublic on create', async () => {
    render(<TagList initialTags={[]} />)

    fireEvent.click(screen.getByRole('button', { name: /add new tag/i }))
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

    fireEvent.click(screen.getByRole('button', { name: /add new tag/i }))
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

    fireEvent.click(screen.getByRole('button', { name: /edit tag/i }))
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

    fireEvent.click(screen.getByRole('button', { name: /add new tag/i }))
    expect(screen.getByRole('button', { name: /create tag/i })).toBeDisabled()

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Design' } })
    expect(screen.getByRole('button', { name: /create tag/i })).toBeEnabled()
  })

  it('previews the typed name next to the field, not a PostTag placeholder', () => {
    render(<TagList initialTags={[]} />)

    fireEvent.click(screen.getByRole('button', { name: /add new tag/i }))
    expect(screen.getByText('Tag name')).toBeTruthy()
    expect(screen.queryByText('PostTag name')).toBeNull()

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Design' } })
    expect(screen.getByText('Design')).toBeTruthy()
    expect(screen.queryByText('Tag name')).toBeNull()
  })

  it('hides the extra color palette until More colors is opened', () => {
    render(<TagList initialTags={[]} />)

    fireEvent.click(screen.getByRole('button', { name: /add new tag/i }))
    expect(screen.getByRole('button', { name: /more colors/i })).toHaveAttribute(
      'aria-expanded',
      'false'
    )

    fireEvent.click(screen.getByRole('button', { name: /more colors/i }))
    expect(screen.getByRole('button', { name: /show less/i })).toHaveAttribute(
      'aria-expanded',
      'true'
    )
  })
})
