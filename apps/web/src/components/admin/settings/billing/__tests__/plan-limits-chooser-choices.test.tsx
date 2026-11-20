// @vitest-environment happy-dom
/**
 * The Plan limits choosers open on what was chosen before, not on the default
 * order, so saving without a change keeps the earlier choice. And nothing the
 * page or a chooser shows uses a word the glossary keeps from users, in
 * either phase, with or without billing rights, with or without a plan name.
 */
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PERMISSIONS, type PermissionKey } from '@/lib/shared/permissions'
import type { PlanLimitsPage } from '@/lib/server/domains/plan-limits/plan-limits.page'
import { overLimits } from './plan-limits-fixtures'

const fns = vi.hoisted(() => ({
  setKeptBoardFn: vi.fn(async (_: unknown) => ({ ok: true as const })),
  setSeatHoldersFn: vi.fn(async (_: unknown) => ({ ok: true as const })),
  setVisibleStatusComponentsFn: vi.fn(async (_: unknown) => ({ ok: true as const })),
  setKeptSendingDomainsFn: vi.fn(async (_: unknown) => ({ ok: true as const })),
  getPlanLimitsSummaryFn: vi.fn(async () => null),
  getPlanLimitsFn: vi.fn(),
}))
vi.mock('@/lib/server/functions/plan-limits', () => fns)

const { PlanLimitsView } = await import('../plan-limits-view')

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-18T12:00:00.000Z'))
  for (const fn of Object.values(fns)) fn.mockClear()
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const BILLING: PermissionKey[] = [PERMISSIONS.BILLING_MANAGE]

function mount(limits: PlanLimitsPage, permissions: PermissionKey[] = BILLING) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <PlanLimitsView limits={limits} permissions={new Set(permissions)} catalogue={null} />
    </QueryClientProvider>
  )
}

async function openAndSave(button: string, confirm = 'Save') {
  fireEvent.click(screen.getByRole('button', { name: button }))
  const dialog = await screen.findByRole('dialog')
  fireEvent.click(within(dialog).getByRole('button', { name: confirm }))
  return dialog
}

const domains = {
  issues: [
    {
      key: 'maxSendingDomains' as const,
      used: 3,
      cap: 1,
      message: 'You have 3 out of 1 sending domains',
      actionLabel: 'Remove 2 sending domains',
      href: '/admin/settings/domains',
    },
  ],
  choosers: { board: false, seats: false, statusComponents: false, sendingDomains: true },
  candidates: {
    sendingDomains: [
      { id: 'd_old', domain: 'mail.example.com', status: 'verified', createdAt: '' },
      { id: 'd_mid', domain: 'news.example.com', status: 'verified', createdAt: '' },
      { id: 'd_new', domain: 'help.example.com', status: 'verified', createdAt: '' },
    ],
  },
}

describe('choosers open on the earlier choice', () => {
  it('keeps the board chosen before, not the one with most posts', async () => {
    mount(overLimits({ keptBoardId: 'board_c', openBoardIds: ['board_c'] }))
    await openAndSave('Choose which board stays open', 'Keep Mobile open')
    await waitFor(() =>
      expect(fns.setKeptBoardFn).toHaveBeenCalledWith({ data: { boardId: 'board_c' } })
    )
  })

  it('keeps who was chosen before, with the owner always in', async () => {
    mount(overLimits({ seatHolderIds: ['p_quiet'] }))
    await openAndSave('Choose who keeps a seat')
    await waitFor(() =>
      expect(fns.setSeatHoldersFn).toHaveBeenCalledWith({ data: { ids: ['p_owner', 'p_quiet'] } })
    )
  })

  it('keeps the status components chosen before, not the first in order', async () => {
    mount(overLimits({ visibleStatusComponentIds: ['c2', 'c4'] }))
    await openAndSave('Choose what shows on your status page')
    await waitFor(() =>
      expect(fns.setVisibleStatusComponentsFn).toHaveBeenCalledWith({ data: { ids: ['c2', 'c4'] } })
    )
  })

  it('keeps the sending domain chosen before, not the oldest', async () => {
    mount(overLimits({ ...domains, sendingDomainIds: ['d_new'] }))
    const dialog = await openAndSave('Choose which domain keeps sending')
    expect(within(dialog).getByRole('radio', { name: 'help.example.com' })).toBeChecked()
    await waitFor(() =>
      expect(fns.setKeptSendingDomainsFn).toHaveBeenCalledWith({ data: { ids: ['d_new'] } })
    )
  })
})

/** Words the glossary never shows users, plus em dashes and exclamation marks. */
const BANNED =
  /\b(grace|frozen|freeze|held|switch(ed|ing)?|enforced|enforcement|extras)\b|current plan|on your plan|choose a plan|choose pro|keep pro|restore what is paused|—|!/i

/** Each text node on its own, so words in neighbouring elements never run together. */
function words(root: Element): string {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const parts: string[] = []
  for (let node = walker.nextNode(); node; node = walker.nextNode())
    parts.push(node.nodeValue ?? '')
  return parts.join(' | ')
}

const CHOOSER_BUTTONS = [
  'Choose which board stays open',
  'Choose who keeps a seat',
  'Choose what shows on your status page',
]

describe('the words on the Plan limits page and its choosers', () => {
  it.each([
    ['grace', 'Free', BILLING],
    ['enforced', 'Free', BILLING],
    ['grace', null, BILLING],
    ['enforced', null, [PERMISSIONS.SETTINGS_MANAGE, PERMISSIONS.MEMBER_MANAGE]],
  ] as const)('in %s with plan %s say none of the kept words', async (phase, planName, perms) => {
    const limits = overLimits({
      phase,
      planName,
      canManageBilling: (perms as readonly PermissionKey[]).includes(PERMISSIONS.BILLING_MANAGE),
      featureIssues: [
        { key: 'webhooks', count: 2, label: 'Webhooks', href: '/x' },
        { key: 'sso', count: 1, label: 'Single sign-on', href: '/x' },
        { key: 'customDomain', count: 1, label: 'Custom domain', href: '/x' },
        { key: 'aiAssistant', count: 1, label: 'AI assistant', href: '/x' },
      ],
    })
    mount(limits, [...perms])
    const texts = [words(document.body)]
    for (const name of CHOOSER_BUTTONS) {
      const button = screen.queryByRole('button', { name })
      if (!button) continue
      fireEvent.click(button)
      const dialog = await screen.findByRole('dialog')
      texts.push(words(dialog))
      fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    }
    expect(texts.length).toBeGreaterThan(1)
    expect(texts.filter((text) => BANNED.test(text))).toEqual([])
    expect(texts.join(' ').match(/Nothing is deleted/g)).toHaveLength(1)
  })
})
