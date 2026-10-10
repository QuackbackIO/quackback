import { describe, it, expect } from 'vitest'
import { SYSTEM_ROLE_PERMISSIONS } from '@/lib/shared/permissions'

const feedback = (await import('../settings.feedback')).Route
const support = (await import('../settings.support')).Route

type Ctx = {
  context: { settings?: { featureFlags?: Record<string, boolean> }; permissions?: string[] }
}
type BeforeLoad = (ctx: Ctx) => Promise<void>

async function redirectOf(
  beforeLoad: unknown,
  flags: Record<string, boolean>,
  permissions: string[] = [...SYSTEM_ROLE_PERMISSIONS.owner]
): Promise<string> {
  let thrown: unknown
  try {
    await (beforeLoad as BeforeLoad)({
      context: { settings: { featureFlags: flags }, permissions },
    })
  } catch (e) {
    thrown = e
  }
  expect(thrown).toBeInstanceOf(Response)
  // oxlint-disable-next-line @typescript-eslint/no-explicit-any
  return (thrown as any).options.to as string
}

describe('module hub routes', () => {
  it('sends /admin/settings/feedback to Boards', async () => {
    expect(await redirectOf(feedback.options.beforeLoad, { feedback: true })).toBe(
      '/admin/settings/boards'
    )
  })

  it('sends /admin/settings/support to Channels when the inbox is on', async () => {
    expect(await redirectOf(support.options.beforeLoad, { supportInbox: true })).toBe(
      '/admin/settings/channels'
    )
  })

  it('sends /admin/settings/support to Email when only tickets are on', async () => {
    expect(await redirectOf(support.options.beforeLoad, { supportTickets: true })).toBe(
      '/admin/settings/channels/email'
    )
  })

  it('falls back to the settings root when the product is off', async () => {
    expect(await redirectOf(feedback.options.beforeLoad, { feedback: false })).toBe(
      '/admin/settings'
    )
    expect(await redirectOf(support.options.beforeLoad, {})).toBe('/admin/settings')
  })

  it('sends a viewer without settings.manage to a Support page they can open', async () => {
    const manager = [...SYSTEM_ROLE_PERMISSIONS.manager]
    expect(manager).not.toContain('settings.manage')
    expect(await redirectOf(support.options.beforeLoad, { supportInbox: true }, manager)).not.toBe(
      '/admin/settings/channels'
    )
  })

  it('sends a viewer who can open none of the module to the settings root', async () => {
    expect(await redirectOf(support.options.beforeLoad, { supportInbox: true }, [])).toBe(
      '/admin/settings'
    )
    expect(await redirectOf(feedback.options.beforeLoad, { feedback: true }, [])).toBe(
      '/admin/settings'
    )
  })

  it('renders no page of its own', async () => {
    expect(feedback.options.component).toBeUndefined()
    expect(support.options.component).toBeUndefined()
  })
})
