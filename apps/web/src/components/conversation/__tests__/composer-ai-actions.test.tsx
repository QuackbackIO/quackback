// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ConversationId } from '@quackback/ids'

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn()
  Element.prototype.hasPointerCapture = vi.fn(() => false)
  Element.prototype.setPointerCapture = vi.fn()
  Element.prototype.releasePointerCapture = vi.fn()
})

afterEach(cleanup)

const hoisted = vi.hoisted(() => ({
  available: true,
  runTransform: vi.fn(),
}))

vi.mock('@/lib/client/hooks/use-copilot-tab-gate', () => ({
  useCopilotTabGate: () => hoisted.available,
}))
vi.mock('@/lib/client/hooks/use-copilot-transform', () => ({
  useCopilotTransform: () => hoisted.runTransform,
}))

import { ComposerAiActions, type ComposerMode } from '../composer-ai-actions'

const conversationId = 'conversation_1' as ConversationId

function renderActions({
  activeMode = 'reply',
  reply = 'Short draft.',
  note = '',
}: {
  activeMode?: ComposerMode
  reply?: string
  note?: string
} = {}) {
  const drafts: Record<ComposerMode, string> = { reply, note }
  const restores: Array<ReturnType<typeof vi.fn>> = []
  const onReplaceDraftText = vi.fn((mode: ComposerMode, text: string) => {
    const previous = drafts[mode]
    drafts[mode] = text
    const restore = vi.fn(() => {
      drafts[mode] = previous
    })
    restores.push(restore)
    return restore
  })
  render(
    <div className="flex flex-wrap">
      <ComposerAiActions
        item={{ kind: 'conversation', id: conversationId }}
        activeMode={activeMode}
        activeDraftText={drafts[activeMode]}
        getDraftText={(mode) => drafts[mode]}
        onReplaceDraftText={onReplaceDraftText}
      />
    </div>
  )

  return { drafts, restores, onReplaceDraftText }
}

async function chooseImprove(label: string) {
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: /improve/i }))
  await user.click(await screen.findByRole('menuitem', { name: label }))
}

beforeEach(() => {
  vi.clearAllMocks()
  hoisted.available = true
  hoisted.runTransform.mockResolvedValue('Improved draft.')
})

describe('<ComposerAiActions>', () => {
  it('stays hidden when Copilot is unavailable', () => {
    hoisted.available = false
    renderActions()

    expect(screen.queryByRole('button', { name: /improve/i })).not.toBeInTheDocument()
  })

  it('improves the visibly active draft and keeps Undo inline', async () => {
    const { onReplaceDraftText, restores } = renderActions({
      activeMode: 'note',
      note: 'Internal draft.',
    })

    await chooseImprove('Rephrase')

    await waitFor(() => {
      expect(onReplaceDraftText).toHaveBeenCalledWith('note', 'Improved draft.')
    })
    expect(hoisted.runTransform).toHaveBeenCalledWith('rephrase', 'Internal draft.')
    expect(screen.getByText('Draft improved.')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(restores[0]).toHaveBeenCalled()
  })

  it('never overwrites text entered while Improve is running', async () => {
    let resolveTransform: (value: string) => void = () => {}
    hoisted.runTransform.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveTransform = resolve
        })
    )
    const { drafts, onReplaceDraftText } = renderActions()

    await chooseImprove('More concise')
    drafts.reply = 'A newer edit.'
    resolveTransform('Concise draft.')

    expect(
      await screen.findByText('Your reply draft changed while Improve was working.')
    ).toBeInTheDocument()
    expect(onReplaceDraftText).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Use improved draft' }))
    expect(onReplaceDraftText).toHaveBeenCalledWith('reply', 'Concise draft.')
  })
})
