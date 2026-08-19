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
  it('renders a checkbox per scope, all checked by default (legacy-equivalent authority)', () => {
    const { getAllByRole } = renderDialog()
    const checkboxes = getAllByRole('checkbox')
    expect(checkboxes).toHaveLength(API_KEY_SCOPES.length)
    for (const box of checkboxes) {
      expect(box.getAttribute('data-state')).toBe('checked')
    }
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

  it('excludes unchecked scopes from the payload', async () => {
    mockCreateApiKeyFn.mockResolvedValue({
      apiKey: { id: 'api_key_1', name: 'Read bot' },
      plainTextKey: 'qb_secret',
    })
    const { getByLabelText, getByRole, onKeyCreated } = renderDialog()

    fireEvent.change(getByLabelText('Name'), { target: { value: 'Read bot' } })
    for (const scope of API_KEY_SCOPES) {
      if (scope.startsWith('write:')) {
        fireEvent.click(getByRole('checkbox', { name: new RegExp(scope) }))
      }
    }
    fireEvent.click(getByRole('button', { name: 'Create Key' }))

    await waitFor(() => expect(onKeyCreated).toHaveBeenCalled())
    const sent = mockCreateApiKeyFn.mock.calls[0][0].data.scopes as string[]
    expect(sent.sort()).toEqual(['read:article', 'read:chat', 'read:feedback'])
  })

  it('disables submit when every scope is unchecked', () => {
    const { getByLabelText, getByRole, getAllByRole } = renderDialog()
    fireEvent.change(getByLabelText('Name'), { target: { value: 'k' } })
    for (const box of getAllByRole('checkbox')) {
      fireEvent.click(box)
    }
    expect(getByRole('button', { name: 'Create Key' })).toBeDisabled()
    expect(mockCreateApiKeyFn).not.toHaveBeenCalled()
  })
})
