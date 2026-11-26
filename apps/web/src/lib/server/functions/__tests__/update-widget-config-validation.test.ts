/**
 * The widget config save validates its input before it reaches the settings
 * service: the launcher announcement switch is kept, and a malformed value
 * is refused. Exercised through the server function itself, with its input
 * validator applied as the server applies it.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  updateWidgetConfig: vi.fn(),
}))

vi.mock('@tanstack/react-start', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-start')>()
  const createServerFn = () => {
    let schema: { parse: (data: unknown) => unknown } | null = null
    const builder = {
      validator: (s: typeof schema) => {
        schema = s
        return builder
      },
      inputValidator: (s: typeof schema) => {
        schema = s
        return builder
      },
      middleware: () => builder,
      handler: (fn: (ctx: { data: unknown }) => unknown) => (opts?: { data?: unknown }) =>
        Promise.resolve().then(() => fn({ data: schema ? schema.parse(opts?.data) : opts?.data })),
    }
    return builder
  }
  return { ...actual, createServerFn }
})

vi.mock('../auth-helpers', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../auth-helpers')>()),
  requireAuth: state.requireAuth,
}))

vi.mock('@/lib/server/domains/settings/settings.widget', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/domains/settings/settings.widget')>()),
  updateWidgetConfig: state.updateWidgetConfig,
}))

const { updateWidgetConfigFn } = await import('../settings')

beforeEach(() => {
  state.requireAuth.mockReset().mockResolvedValue({
    settings: { id: 'workspace_1' },
    principal: { id: 'principal_1' },
  })
  state.updateWidgetConfig.mockReset().mockImplementation(async (input: unknown) => input)
})

describe('updateWidgetConfigFn launcher announcement', () => {
  it('saves the switch under the changelog settings', async () => {
    await updateWidgetConfigFn({ data: { changelog: { announceOnLauncher: true } } })
    expect(state.updateWidgetConfig).toHaveBeenCalledWith({
      changelog: { announceOnLauncher: true },
    })
  })

  it('refuses a non-boolean switch without saving', async () => {
    await expect(
      updateWidgetConfigFn({ data: { changelog: { announceOnLauncher: 'yes' } } as never })
    ).rejects.toThrow()
    expect(state.updateWidgetConfig).not.toHaveBeenCalled()
  })
})
