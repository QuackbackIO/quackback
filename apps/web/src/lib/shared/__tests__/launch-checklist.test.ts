import { describe, expect, it } from 'vitest'
import { buildLaunchTasks, normalizeOutcome } from '../launch-checklist'
import type { LaunchStatus } from '../launch-checklist'

const base: LaunchStatus = {
  hasBoards: false,
  boardCount: 0,
  maxBoards: null,
  memberCount: 1,
  hasBranding: false,
  hasWidgetInstalled: false,
  hasWidgetEnabled: false,
  hasMessengerEnabled: false,
  hasHelpArticle: false,
  hasPublishedChangelog: false,
  hasStatusComponent: false,
  hasIntegration: false,
  hasFirstWin: false,
  useCase: 'product_feedback',
}

const noExtraModules = {
  supportInbox: false,
  helpCenter: false,
  statusPage: false,
  integrations: true,
  changelog: false,
} as const

describe('normalizeOutcome', () => {
  it('maps legacy industries while preserving V2 outcomes', () => {
    expect(normalizeOutcome('saas')).toBe('product_feedback')
    expect(normalizeOutcome('customer_support')).toBe('customer_support')
    expect(normalizeOutcome(null)).toBe('product_feedback')
  })
})

describe('buildLaunchTasks', () => {
  it('always includes create-board and completes it on any board', () => {
    expect(buildLaunchTasks(base).find((task) => task.id === 'create-board')?.isCompleted).toBe(
      false
    )
    expect(
      buildLaunchTasks({ ...base, hasBoards: true, hasPublicBoard: false }).find(
        (task) => task.id === 'create-board'
      )?.isCompleted
    ).toBe(true)
  })

  it('hides share until a public board exists', () => {
    expect(
      buildLaunchTasks({ ...base, features: noExtraModules }).some(
        (task) => task.id === 'distribute-feedback'
      )
    ).toBe(false)
    expect(
      buildLaunchTasks({
        ...base,
        hasBoards: true,
        hasPublicBoard: false,
        features: noExtraModules,
      }).some((task) => task.id === 'distribute-feedback')
    ).toBe(false)
    expect(
      buildLaunchTasks({
        ...base,
        hasBoards: true,
        hasPublicBoard: true,
        features: noExtraModules,
      }).some((task) => task.id === 'distribute-feedback')
    ).toBe(true)
  })

  it('adds changelog by default and completes only on a published entry', () => {
    const draft = buildLaunchTasks(base).find((task) => task.id === 'publish-changelog')
    expect(draft?.isCompleted).toBe(false)
    expect(draft?.href).toBe('/admin/changelog')
    expect(
      buildLaunchTasks({ ...base, hasPublishedChangelog: true }).find(
        (task) => task.id === 'publish-changelog'
      )?.isCompleted
    ).toBe(true)
    expect(
      buildLaunchTasks({ ...base, features: noExtraModules }).some(
        (task) => task.id === 'publish-changelog'
      )
    ).toBe(false)
  })

  it('composes essentials from enabled modules', () => {
    const ids = buildLaunchTasks({
      ...base,
      features: {
        supportInbox: true,
        helpCenter: true,
        statusPage: true,
        integrations: true,
        changelog: true,
      },
    })
      .filter((task) => task.classification === 'prerequisite')
      .map((task) => task.id)
    expect(ids).toEqual([
      'create-board',
      'publish-changelog',
      'connect-messenger',
      'set-up-quinn',
      'help-article',
      'add-status-service',
    ])
  })

  it('keeps Connect Messenger pending until installation is externally observed', () => {
    const configured = buildLaunchTasks({
      ...base,
      features: { ...noExtraModules, supportInbox: true },
      hasWidgetEnabled: true,
      hasWidgetInstalled: false,
    })
    expect(configured.find((task) => task.id === 'connect-messenger')?.isCompleted).toBe(false)
    expect(
      configured.filter((task) => task.classification === 'prerequisite').map((t) => t.id)
    ).toEqual(['create-board', 'connect-messenger', 'set-up-quinn'])
  })

  it('completes Connect Messenger when the SDK is observed and the widget is on', () => {
    const task = buildLaunchTasks({
      ...base,
      hasWidgetInstalled: true,
      hasWidgetEnabled: true,
      features: { ...noExtraModules, supportInbox: true },
    }).find((row) => row.id === 'connect-messenger')
    expect(task?.isCompleted).toBe(true)
  })

  describe('Set up Quinn', () => {
    const withSupport = { ...base, features: { ...noExtraModules, supportInbox: true } }
    const quinn = (status: LaunchStatus) =>
      buildLaunchTasks(status).find((task) => task.id === 'set-up-quinn')

    it('is offered only while the Support inbox is on', () => {
      expect(quinn(base)).toBeUndefined()
      expect(quinn(withSupport)).toBeDefined()
    })

    it('is left out when the plan lacks the assistant or no AI model is configured', () => {
      expect(
        quinn({ ...withSupport, features: { ...withSupport.features, assistant: false } })
      ).toBe(undefined)
      expect(
        quinn({ ...withSupport, features: { ...withSupport.features, assistant: true } })
      ).toBeDefined()
    })

    it('stays out while the Support inbox is off even when Quinn can answer', () => {
      expect(quinn({ ...base, features: { ...noExtraModules, assistant: true } })).toBeUndefined()
    })

    it('is done when the Agent is on and answering, and open otherwise', () => {
      expect(quinn({ ...withSupport, hasAgentAnswering: true })?.isCompleted).toBe(true)
      expect(quinn({ ...withSupport, hasAgentAnswering: false })?.isCompleted).toBe(false)
      expect(quinn(withSupport)?.isCompleted).toBe(false)
    })

    it('opens the Agent settings for an assistant manager', () => {
      const task = quinn({ ...withSupport, hasAgentAnswering: false })
      expect(task?.href).toBe('/admin/settings/agent')
      expect(task?.actionLabel).toBe('Set up Quinn')
      expect(task?.availability).toBe('available')
    })

    it('is blocked without a link for someone who cannot manage the assistant', () => {
      const task = quinn({
        ...withSupport,
        hasAgentAnswering: false,
        permissions: {
          settingsManage: true,
          boardManage: true,
          memberManage: true,
          brandingManage: true,
          integrationManage: true,
          helpCenterManage: true,
          assistantManage: false,
        },
      })
      expect(task?.availability).toBe('blocked')
      expect(task?.href).toBeUndefined()
    })
  })

  it('blocks the board step at the plan limit', () => {
    const status = { ...base, boardCount: 1, maxBoards: 1, features: noExtraModules }
    const board = buildLaunchTasks(status).find((task) => task.id === 'create-board')
    expect(board?.availability).toBe('blocked')
    expect(board?.blocked?.kind).toBe('plan-limit')
  })

  it('hides Help Center and Support rows when those modules are off', () => {
    const tasks = buildLaunchTasks({
      ...base,
      useCase: 'help_center',
      hasHelpArticle: true,
      features: noExtraModules,
    })
    expect(tasks.some((task) => task.id === 'help-article')).toBe(false)
    expect(tasks.some((task) => task.id === 'connect-messenger')).toBe(false)
  })

  it('removes action links when the caller lacks the responsible permission', () => {
    const tasks = buildLaunchTasks({
      ...base,
      features: noExtraModules,
      permissions: {
        settingsManage: false,
        boardManage: false,
        memberManage: false,
        brandingManage: false,
        integrationManage: false,
        helpCenterManage: false,
        assistantManage: false,
      },
    })
    expect(tasks.filter((task) => task.href)).toHaveLength(0)
    expect(tasks.find((task) => task.id === 'create-board')?.availability).toBe('blocked')
  })

  it('reads legacy deferred rows as skipped', () => {
    const tasks = buildLaunchTasks({
      ...base,
      features: noExtraModules,
      taskResolutions: {
        product_feedback: {
          'create-board': {
            resolution: 'deferred',
            resolvedAt: '2026-07-13T10:00:00.000Z',
          },
        },
      },
    })
    expect(tasks.find((task) => task.id === 'create-board')!.isSkipped).toBe(true)
  })

  it('opens Connect Messenger and Invite in place, and completes Invite on the first invite sent', () => {
    const support: LaunchStatus = {
      ...base,
      features: { ...noExtraModules, supportInbox: true },
      permissions: {
        settingsManage: true,
        boardManage: true,
        memberManage: true,
        brandingManage: true,
        integrationManage: true,
        helpCenterManage: true,
        assistantManage: true,
      },
    }
    const find = (status: LaunchStatus, id: string) =>
      buildLaunchTasks(status, 'customer_support').find((task) => task.id === id)
    expect(find(support, 'connect-messenger')?.sheet).toBe('install-messenger')
    expect(find(support, 'invite-team')?.sheet).toBe('invite-team')
    expect(find(support, 'invite-team')?.isCompleted).toBe(false)
    expect(find({ ...support, hasTeamInvite: true }, 'invite-team')?.isCompleted).toBe(true)
    const noPermission: LaunchStatus = {
      ...support,
      permissions: { ...support.permissions!, memberManage: false },
    }
    expect(find(noPermission, 'invite-team')?.sheet).toBeUndefined()
  })

  it('keeps invite as polish, except for private team feedback, where it is the first step', () => {
    expect(
      buildLaunchTasks(base, 'product_feedback').find((task) => task.id === 'invite-team')
        ?.classification
    ).toBe('polish')
    expect(
      buildLaunchTasks(base, 'internal').find((task) => task.id === 'invite-team')?.classification
    ).toBe('prerequisite')
  })

  it.each([
    { publicBoardLinkCopiedAt: '2026-08-14T10:00:00.000Z' },
    { hasWidgetInstalled: true, hasWidgetEnabled: true },
    { hasFirstWin: true },
  ])('accepts any real distribution signal: %o', (signal) => {
    const task = buildLaunchTasks({
      ...base,
      hasPublicBoard: true,
      features: noExtraModules,
      ...signal,
    }).find((candidate) => candidate.id === 'distribute-feedback')
    expect(task?.isCompleted).toBe(true)
  })
})
