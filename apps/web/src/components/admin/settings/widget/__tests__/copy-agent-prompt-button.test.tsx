// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const { copyWithFallback } = vi.hoisted(() => ({
  copyWithFallback: vi.fn(),
}))

vi.mock('@/components/admin/activation-action-button', () => ({
  copyWithFallback: (...args: unknown[]) => copyWithFallback(...args),
}))

import { CopyAgentPromptButton } from '../copy-agent-prompt-button'

describe('CopyAgentPromptButton', () => {
  beforeEach(() => {
    copyWithFallback.mockReset()
    copyWithFallback.mockResolvedValue(undefined)
  })

  it('resolves getPrompt on click, copies it, and shows a success label', async () => {
    const getPrompt = vi.fn().mockResolvedValue('prompt with qbi_code')
    render(<CopyAgentPromptButton getPrompt={getPrompt} />)

    const button = screen.getByRole('button', { name: 'Copy install prompt' })
    expect(screen.queryByLabelText('Claude')).toBeNull()

    fireEvent.click(button)

    await waitFor(() => {
      expect(getPrompt).toHaveBeenCalled()
      expect(copyWithFallback).toHaveBeenCalledWith('prompt with qbi_code')
      expect(screen.getByRole('button', { name: 'Prompt copied' })).toBeTruthy()
    })
  })
})
