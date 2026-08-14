import { describe, expect, it } from 'vitest'
import { selectActivationAction, type ActivationSurface } from '../activation-action'
import type { LaunchStatus } from '../launch-checklist'

const base: LaunchStatus = {
  hasBoards: false,
  hasPublicBoard: false,
  memberCount: 1,
  hasBranding: false,
  hasWidgetEnabled: false,
  hasWidgetInstalled: false,
  hasMessengerEnabled: false,
  hasFirstWin: false,
  useCase: 'product_feedback',
}

function action(surface: ActivationSurface, overrides: Partial<LaunchStatus> = {}) {
  return selectActivationAction({ surface, status: { ...base, ...overrides } })
}

describe('selectActivationAction', () => {
  it('creates a board before offering distribution', () => {
    expect(action('feedback_empty')).toMatchObject({
      id: 'create-feedback-board',
      kind: 'link',
      destination: '/admin/settings/boards',
    })
  })

  it('copies the board link after a public board exists', () => {
    expect(
      action('feedback_empty', {
        hasBoards: true,
        hasPublicBoard: true,
        publicBoardId: 'board_1',
        publicBoardPath: '/?board=feedback',
      })
    ).toEqual({
      id: 'copy-board-link',
      outcome: 'product_feedback',
      label: 'Copy board link',
      kind: 'copy',
      payload: { boardId: 'board_1', path: '/?board=feedback' },
    })
  })

  it.each([
    { publicBoardLinkCopiedAt: '2026-08-14T10:00:00.000Z' },
    { hasWidgetInstalled: true },
    { hasFirstWin: true },
  ])('does not show feedback setup after distribution: %o', (signal) => {
    expect(
      action('feedback_empty', {
        hasPublicBoard: true,
        publicBoardId: 'board_1',
        publicBoardPath: '/?board=feedback',
        ...signal,
      })
    ).toBeNull()
  })

  it('connects Messenger only for the customer-support outcome', () => {
    expect(action('conversation_empty', { useCase: 'customer_support' })).toMatchObject({
      id: 'connect-messenger',
      destination: '/admin/settings/widget/install',
    })
    expect(action('conversation_empty', { useCase: 'product_feedback' })).toBeNull()
  })

  it('opens the observed site after Messenger installation', () => {
    expect(
      action('conversation_empty', {
        useCase: 'customer_support',
        hasWidgetInstalled: true,
        widgetOriginHost: 'app.example.com',
      })
    ).toEqual({
      id: 'open-installed-site',
      outcome: 'customer_support',
      label: 'Open your site',
      kind: 'external',
      destination: 'https://app.example.com',
    })
  })

  it('refuses to turn malformed observed hostnames into external links', () => {
    expect(
      action('conversation_empty', {
        useCase: 'customer_support',
        hasWidgetInstalled: true,
        widgetOriginHost: 'example.com/path',
      })
    ).toBeNull()
  })
})
