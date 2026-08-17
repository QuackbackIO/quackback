import { describe, expect, it } from 'vitest'
import {
  resolveOnboardingHandoffCtas,
  selectActivationAction,
  type ActivationSurface,
} from '../activation-action'
import type { StartingPointState } from '../db-types'
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

  const createdBoard: StartingPointState = {
    outcome: 'product_feedback',
    resourceType: 'board',
    resourceId: 'board_1',
    source: 'wizard',
    resolution: 'created',
    completedAt: '2026-08-14T12:00:00.000Z',
  }

  it('opens the board when the product-feedback handoff has no public path', () => {
    expect(
      selectActivationAction({
        surface: 'onboarding_handoff',
        startingPoint: createdBoard,
        status: base,
      })
    ).toMatchObject({
      id: 'open-feedback-board',
      kind: 'link',
      destination: '/admin/feedback',
    })
  })

  it('keeps a way into the workspace when the board link is copyable', () => {
    const ctas = resolveOnboardingHandoffCtas({
      startingPoint: createdBoard,
      status: {
        ...base,
        hasBoards: true,
        hasPublicBoard: true,
        publicBoardId: 'board_1',
        publicBoardPath: '/?board=feedback',
      },
    })
    expect(ctas.primary).toMatchObject({
      id: 'open-feedback-board',
      kind: 'link',
      destination: '/admin/feedback',
    })
    expect(ctas.share).toMatchObject({
      id: 'copy-board-link',
      kind: 'copy',
    })
  })

  it('always returns a primary Ready-step action', () => {
    const ctas = resolveOnboardingHandoffCtas({
      startingPoint: createdBoard,
      status: base,
    })
    expect(ctas.primary.kind).toBe('link')
    expect(ctas.primary.destination).toBe('/admin/feedback')
    expect(ctas.share).toBeNull()
  })

  it.each([
    {
      startingPoint: {
        outcome: 'customer_support' as const,
        resourceType: 'messenger' as const,
        resourceId: undefined,
        source: 'wizard' as const,
        resolution: 'created' as const,
        completedAt: '2026-08-14T12:00:00.000Z',
      },
      id: 'connect-messenger',
      destination: '/admin/settings/widget/install',
    },
    {
      startingPoint: {
        outcome: 'help_center' as const,
        resourceType: 'article' as const,
        resourceId: 'art_1',
        source: 'wizard' as const,
        resolution: 'created' as const,
        completedAt: '2026-08-14T12:00:00.000Z',
      },
      id: 'continue-help-article',
      destination: '/admin/help-center/articles/art_1',
    },
    {
      startingPoint: {
        outcome: 'internal' as const,
        resourceType: 'board' as const,
        resourceId: 'board_1',
        source: 'wizard' as const,
        resolution: 'created' as const,
        completedAt: '2026-08-14T12:00:00.000Z',
      },
      id: 'invite-teammate',
      destination: '/admin/settings/members',
    },
  ])('Ready primary for $startingPoint.outcome is $id', ({ startingPoint, id, destination }) => {
    const ctas = resolveOnboardingHandoffCtas({ startingPoint, status: base })
    expect(ctas.primary).toMatchObject({ id, kind: 'link', destination })
    expect(ctas.share).toBeNull()
  })

  it('does not offer Messenger as the product-feedback Ready action', () => {
    const ctas = resolveOnboardingHandoffCtas({
      startingPoint: createdBoard,
      status: { ...base, useCase: 'product_feedback' },
    })
    expect(ctas.primary.id).not.toBe('connect-messenger')
  })
})
