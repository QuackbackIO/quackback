/**
 * The dormancy rule: idle past the threshold, no standing work → dormant.
 * Unknown (no stamp) is never dormant; `0` switches the policy off.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const unsafe = vi.fn(async (_query: string, _params: unknown[]) => [] as unknown[])
const configState = { isPooledTenancy: true, workspaceDormantAfterHours: 168 }

vi.mock('@/lib/server/config', () => ({
  config: {
    get isPooledTenancy() {
      return configState.isPooledTenancy
    },
    get workspaceDormantAfterHours() {
      return configState.workspaceDormantAfterHours
    },
  },
}))
vi.mock('../registry', () => ({ getControlSql: () => ({ unsafe }) }))

const HOUR = 3_600_000
const NOW = Date.UTC(2026, 8, 6, 12, 0, 0)

async function load() {
  const mod = await import('../activity')
  mod.__resetWorkspaceActivityForTests()
  return mod
}

beforeEach(() => {
  vi.clearAllMocks()
  configState.isPooledTenancy = true
  configState.workspaceDormantAfterHours = 168
})

afterEach(async () => {
  ;(await import('../activity')).__resetWorkspaceActivityForTests()
})

describe('isPastDormancyThreshold', () => {
  it('is dormant only once the stamp is older than the threshold', async () => {
    const { isPastDormancyThreshold } = await load()
    expect(isPastDormancyThreshold(new Date(NOW - 168 * HOUR - 1), NOW)).toBe(true)
    expect(isPastDormancyThreshold(new Date(NOW - 168 * HOUR), NOW)).toBe(false)
    expect(isPastDormancyThreshold(new Date(NOW - HOUR), NOW)).toBe(false)
  })

  it('never parks a workspace with no stamp', async () => {
    const { isPastDormancyThreshold } = await load()
    expect(isPastDormancyThreshold(null, NOW)).toBe(false)
    expect(isPastDormancyThreshold(new Date('not a date'), NOW)).toBe(false)
  })

  it('is switched off by a threshold of 0', async () => {
    configState.workspaceDormantAfterHours = 0
    const { isPastDormancyThreshold } = await load()
    expect(isPastDormancyThreshold(new Date(0), NOW)).toBe(false)
  })

  it('reads the configured threshold', async () => {
    configState.workspaceDormantAfterHours = 24
    const { isPastDormancyThreshold } = await load()
    expect(isPastDormancyThreshold(new Date(NOW - 25 * HOUR), NOW)).toBe(true)
    expect(isPastDormancyThreshold(new Date(NOW - 23 * HOUR), NOW)).toBe(false)
  })
})

describe('isActivitySignal', () => {
  // Not a real `Request`: happy-dom's strips the forbidden `cookie` header,
  // which is precisely the header under test. The predicate needs only this shape.
  const req = (method: string, headers: Record<string, string> = {}) => ({
    method,
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
  })

  it('ignores anonymous reads — what crawlers and scanners send', async () => {
    const { isActivitySignal } = await load()
    expect(isActivitySignal(req('GET'))).toBe(false)
    expect(isActivitySignal(req('HEAD'))).toBe(false)
    expect(isActivitySignal(req('OPTIONS'))).toBe(false)
    expect(isActivitySignal(req('GET', { cookie: 'theme=dark' }))).toBe(false)
    expect(isActivitySignal(req('GET', { authorization: 'Basic abc' }))).toBe(false)
  })

  it('counts every mutation', async () => {
    const { isActivitySignal } = await load()
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      expect(isActivitySignal(req(method))).toBe(true)
    }
  })

  it('counts a read from a signed-in session or a bearer token', async () => {
    const { isActivitySignal } = await load()
    expect(isActivitySignal(req('GET', { cookie: 'a=1; better-auth.session_token=t' }))).toBe(true)
    expect(isActivitySignal(req('GET', { cookie: '__Secure-better-auth.session_token=t' }))).toBe(
      true
    )
    expect(isActivitySignal(req('GET', { authorization: 'Bearer qb_key' }))).toBe(true)
  })
})

describe('noteWorkspaceActivity', () => {
  it('upserts the stamp once, then throttles the same workspace', async () => {
    const { noteWorkspaceActivity, STAMP_INTERVAL_MS } = await load()
    await noteWorkspaceActivity('inst_a', NOW)
    await noteWorkspaceActivity('inst_a', NOW + 1_000)
    await noteWorkspaceActivity('inst_a', NOW + STAMP_INTERVAL_MS - 1)
    expect(unsafe).toHaveBeenCalledTimes(1)
    expect(unsafe.mock.calls[0]?.[0]).toMatch(/INSERT INTO cp_workspace_activity/)
    expect(unsafe.mock.calls[0]?.[0]).toMatch(/ON CONFLICT \(workspace_key\) DO UPDATE/)
    expect(unsafe.mock.calls[0]?.[1]).toEqual(['inst_a'])

    await noteWorkspaceActivity('inst_a', NOW + STAMP_INTERVAL_MS)
    expect(unsafe).toHaveBeenCalledTimes(2)
  })

  it('throttles per workspace, not globally', async () => {
    const { noteWorkspaceActivity } = await load()
    await noteWorkspaceActivity('inst_a', NOW)
    await noteWorkspaceActivity('inst_b', NOW)
    expect(unsafe).toHaveBeenCalledTimes(2)
  })

  it('does nothing outside pooled tenancy', async () => {
    configState.isPooledTenancy = false
    const { noteWorkspaceActivity } = await load()
    await noteWorkspaceActivity('inst_a', NOW)
    expect(unsafe).not.toHaveBeenCalled()
  })

  it('swallows a failed write and retries on the next request', async () => {
    const { noteWorkspaceActivity } = await load()
    unsafe.mockRejectedValueOnce(new Error('relation does not exist'))
    await expect(noteWorkspaceActivity('inst_a', NOW)).resolves.toBeUndefined()
    await noteWorkspaceActivity('inst_a', NOW + 1_000)
    expect(unsafe).toHaveBeenCalledTimes(2)
  })
})

describe('shouldSkipForDormancy', () => {
  it('skips an idle workspace, unless the worker found standing work for it', async () => {
    const { shouldSkipForDormancy, markStandingWork } = await load()
    const idle = { workspaceKey: 'inst_a', lastActiveAt: new Date(NOW - 200 * HOUR) }
    expect(shouldSkipForDormancy(idle, NOW)).toBe(true)
    markStandingWork('inst_a', true)
    expect(shouldSkipForDormancy(idle, NOW)).toBe(false)
    markStandingWork('inst_a', false)
    expect(shouldSkipForDormancy(idle, NOW)).toBe(true)
  })

  it('never skips a recently active or unstamped workspace', async () => {
    const { shouldSkipForDormancy } = await load()
    expect(shouldSkipForDormancy({ workspaceKey: 'a', lastActiveAt: new Date(NOW) }, NOW)).toBe(
      false
    )
    expect(shouldSkipForDormancy({ workspaceKey: 'b', lastActiveAt: null }, NOW)).toBe(false)
  })
})

describe('dormancy marks', () => {
  it('track what the worker parked', async () => {
    const {
      markDormant,
      isMarkedDormant,
      dormantCount,
      listDormantWorkspaces,
      resetDormancyMarks,
    } = await load()
    markDormant('inst_a', true)
    markDormant('inst_b', true)
    markDormant('inst_a', false)
    expect(isMarkedDormant('inst_a')).toBe(false)
    expect(isMarkedDormant('inst_b')).toBe(true)
    expect(dormantCount()).toBe(1)
    expect(listDormantWorkspaces()).toEqual(['inst_b'])
    resetDormancyMarks()
    expect(dormantCount()).toBe(0)
  })
})
