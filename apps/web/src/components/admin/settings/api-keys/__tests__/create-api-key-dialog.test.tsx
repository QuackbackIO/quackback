// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { API_KEY_SCOPES } from '@/lib/server/domains/api-keys/api-key-scopes'

const { mockCreateApiKeyFn } = vi.hoisted(() => ({
  mockCreateApiKeyFn: vi.fn(),
}))

vi.mock('@/lib/server/functions/api-keys', () => ({
  createApiKeyFn: mockCreateApiKeyFn,
}))

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}))

vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({ invalidate: vi.fn() }),
}))

import { CreateApiKeyDialog } from '../create-api-key-dialog'

function renderDialog(onKeyCreated = vi.fn()) {
  return {
    onKeyCreated,
    ...render(
      <CreateApiKeyDialog open={true} onOpenChange={vi.fn()} onKeyCreated={onKeyCreated} />
    ),
  }
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('CreateApiKeyDialog scopes', () => {
  it('defaults every domain to its maximum level (legacy-equivalent authority)', () => {
    const { getByRole } = renderDialog()
    expect(getByRole('button', { name: 'Feedback: Read and write' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    expect(getByRole('button', { name: 'Help Center: Read and write' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    expect(getByRole('button', { name: 'Conversations: Read and write' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    expect(getByRole('button', { name: 'Changelog: Write' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    expect(getByRole('button', { name: 'Feedback: Read' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('submits the selected scopes with the key name', async () => {
    mockCreateApiKeyFn.mockResolvedValue({
      apiKey: { id: 'api_key_1', name: 'CI' },
      plainTextKey: 'qb_secret',
    })
    const { getByLabelText, getByRole, onKeyCreated } = renderDialog()

    fireEvent.change(getByLabelText('Name'), { target: { value: 'CI' } })
    fireEvent.click(getByRole('button', { name: 'Create Key' }))

    await waitFor(() => expect(onKeyCreated).toHaveBeenCalled())
    expect(mockCreateApiKeyFn).toHaveBeenCalledWith({
      data: { name: 'CI', scopes: [...API_KEY_SCOPES] },
    })
  })

  it('stores only the three reads after downgrading every domain from Read and write', async () => {
    mockCreateApiKeyFn.mockResolvedValue({
      apiKey: { id: 'api_key_1', name: 'Read bot' },
      plainTextKey: 'qb_secret',
    })
    const { getByLabelText, getByRole, onKeyCreated } = renderDialog()

    fireEvent.change(getByLabelText('Name'), { target: { value: 'Read bot' } })
    fireEvent.click(getByRole('button', { name: 'Feedback: Read' }))
    fireEvent.click(getByRole('button', { name: 'Help Center: Read' }))
    fireEvent.click(getByRole('button', { name: 'Conversations: Read' }))
    fireEvent.click(getByRole('button', { name: 'Changelog: Write' }))
    fireEvent.click(getByRole('button', { name: 'Create Key' }))

    await waitFor(() => expect(onKeyCreated).toHaveBeenCalled())
    const sent = mockCreateApiKeyFn.mock.calls[0][0].data.scopes as string[]
    expect(sent).toEqual(['read:feedback', 'read:article', 'read:chat'])
  })

  it('disables submit when every domain is off', () => {
    const { getByLabelText, getByRole } = renderDialog()
    fireEvent.change(getByLabelText('Name'), { target: { value: 'k' } })
    fireEvent.click(getByRole('button', { name: 'Feedback: Read and write' }))
    fireEvent.click(getByRole('button', { name: 'Help Center: Read and write' }))
    fireEvent.click(getByRole('button', { name: 'Conversations: Read and write' }))
    fireEvent.click(getByRole('button', { name: 'Changelog: Write' }))
    expect(getByRole('button', { name: 'Create Key' })).toBeDisabled()
    expect(mockCreateApiKeyFn).not.toHaveBeenCalled()
  })
})
