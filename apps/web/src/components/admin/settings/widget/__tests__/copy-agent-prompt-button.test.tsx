// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { CopyAgentPromptButton } from '../copy-agent-prompt-button'

describe('CopyAgentPromptButton', () => {
  beforeEach(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    })
  })

  it('copies the prompt and shows a success label', async () => {
    render(<CopyAgentPromptButton prompt="Install the Quackback widget" />)

    const button = screen.getByRole('button', {
      name: 'Copy install prompt for your coding agent',
    })
    expect(screen.getByLabelText('Claude')).toBeTruthy()
    expect(screen.getByLabelText('Cursor')).toBeTruthy()
    expect(screen.getByLabelText('Codex')).toBeTruthy()
    expect(screen.getByLabelText('Copilot')).toBeTruthy()

    fireEvent.click(button)

    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith('Install the Quackback widget')
      expect(screen.getByRole('button', { name: 'Install prompt copied' })).toBeTruthy()
    })
  })

  it('resolves getPrompt on click so a pairing code can be minted then', async () => {
    const getPrompt = vi.fn().mockResolvedValue('prompt with qbi_code')
    render(<CopyAgentPromptButton getPrompt={getPrompt} />)

    fireEvent.click(
      screen.getByRole('button', { name: 'Copy install prompt for your coding agent' })
    )

    await waitFor(() => {
      expect(getPrompt).toHaveBeenCalled()
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith('prompt with qbi_code')
    })
  })
})
