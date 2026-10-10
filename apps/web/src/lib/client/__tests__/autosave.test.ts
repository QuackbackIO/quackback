import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MutationCache, QueryClient } from '@tanstack/react-query'

const toastError = vi.hoisted(() => vi.fn())
vi.mock('sonner', () => ({ toast: { error: toastError } }))

const { AUTOSAVE, createAutosaveMutationCache, isRevisionConflict } = await import('../autosave')
const { ASSISTANT_REVISION_CONFLICT_MESSAGE } = await import('@/lib/shared/assistant/config')

afterEach(() => toastError.mockClear())

function clientWithHandler() {
  const cache = createAutosaveMutationCache()
  expect(cache).toBeInstanceOf(MutationCache)
  return new QueryClient({ mutationCache: cache })
}

describe('autosave mutation errors', () => {
  it('shows the toast exactly once when an autosave mutation fails', async () => {
    const client = clientWithHandler()
    const mutation = client
      .getMutationCache()
      .build(client, { meta: AUTOSAVE, mutationFn: async () => Promise.reject(new Error('nope')) })
    await expect(mutation.execute(undefined)).rejects.toThrow('nope')
    await vi.waitFor(() => expect(toastError).toHaveBeenCalledTimes(1))
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(toastError).toHaveBeenCalledTimes(1)
    expect(toastError).toHaveBeenCalledWith("Couldn't save. Try again.")
  })

  it('loads sonner lazily so it stays out of the entry chunk', () => {
    const source = readFileSync(new URL('../autosave.ts', import.meta.url), 'utf8')
    expect(source).not.toMatch(/^import .* from 'sonner'/m)
    expect(source).toContain("import('sonner')")
  })

  it('shows nothing for a failing mutation that is not an autosave', async () => {
    const client = clientWithHandler()
    const plain = client
      .getMutationCache()
      .build(client, { mutationFn: async () => Promise.reject(new Error('nope')) })
    await expect(plain.execute(undefined)).rejects.toThrow('nope')
    const other = client.getMutationCache().build(client, {
      meta: { autosave: false },
      mutationFn: async () => Promise.reject(new Error('nope')),
    })
    await expect(other.execute(undefined)).rejects.toThrow('nope')
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(toastError).not.toHaveBeenCalled()
  })

  it('shows nothing when an autosave mutation succeeds', async () => {
    const client = clientWithHandler()
    const mutation = client
      .getMutationCache()
      .build(client, { meta: AUTOSAVE, mutationFn: async () => 'ok' })
    await mutation.execute(undefined)
    expect(toastError).not.toHaveBeenCalled()
  })
})

describe('revision conflict detection', () => {
  // A failing server function reaches the client as a plain Error that carries
  // only the server's message; the typed error and its status do not survive.
  const serverMessage = new Error(ASSISTANT_REVISION_CONFLICT_MESSAGE)

  it('recognises the error as it arrives through the server function boundary', () => {
    expect(isRevisionConflict(serverMessage)).toBe(true)
  })

  it('also recognises the typed shapes', () => {
    expect(isRevisionConflict(Object.assign(new Error('x'), { statusCode: 409 }))).toBe(true)
    expect(
      isRevisionConflict(
        Object.assign(new Error('x'), { code: 'ASSISTANT_CONFIG_REVISION_CONFLICT' })
      )
    ).toBe(true)
  })

  it('does not treat other failures as conflicts', () => {
    expect(isRevisionConflict(new Error('boom'))).toBe(false)
    expect(isRevisionConflict(new Error('Use 80 characters or fewer.'))).toBe(false)
    expect(isRevisionConflict(null)).toBe(false)
    expect(isRevisionConflict('changed in another session')).toBe(false)
  })

  it('leaves a conflict to the page when the mutation owns it, and toasts other failures', async () => {
    const client = clientWithHandler()
    const owned = client.getMutationCache().build(client, {
      meta: { ...AUTOSAVE, ownsError: isRevisionConflict },
      mutationFn: async () => Promise.reject(serverMessage),
    })
    await expect(owned.execute(undefined)).rejects.toThrow('changed in another session')
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(toastError).not.toHaveBeenCalled()
    const other = client.getMutationCache().build(client, {
      meta: { ...AUTOSAVE, ownsError: isRevisionConflict },
      mutationFn: async () => Promise.reject(new Error('nope')),
    })
    await expect(other.execute(undefined)).rejects.toThrow('nope')
    await vi.waitFor(() => expect(toastError).toHaveBeenCalledTimes(1))
  })

  it('toasts a conflict when the mutation does not own it', async () => {
    const client = clientWithHandler()
    const mutation = client.getMutationCache().build(client, {
      meta: AUTOSAVE,
      mutationFn: async () => Promise.reject(serverMessage),
    })
    await expect(mutation.execute(undefined)).rejects.toThrow()
    await vi.waitFor(() => expect(toastError).toHaveBeenCalledTimes(1))
  })
})

describe('settings autosave hooks', () => {
  const source = readFileSync(new URL('../mutations/settings.ts', import.meta.url), 'utf8')
  const body = (hook: string) => {
    const start = source.indexOf(`export function ${hook}(`)
    expect(start, hook).toBeGreaterThan(-1)
    const end = source.indexOf('\nexport function', start + 1)
    return source.slice(start, end === -1 ? undefined : end)
  }

  it.each([
    'useUpdateModerationDefault',
    'useUpdateWidgetConfig',
    'useUpdateHelpCenterConfig',
    'useUpdateHelpCenterSeo',
    'useUpdateWorkflowAbandonedAutoClose',
    'useUpdateWorkflowCloseSpam',
    'useUpdateDefaultSlaPolicy',
  ])('%s is tagged as an autosave', (hook) => {
    expect(body(hook)).toContain('meta: AUTOSAVE')
  })

  it('tags the portal config save as an autosave a page can extend', () => {
    expect(body('useUpdatePortalConfig')).toContain('...AUTOSAVE')
  })

  it('tags the branding theme save as an autosave that names server reasons', () => {
    expect(body('useSaveBrandingTheme')).toContain('...AUTOSAVE')
  })

  it('leaves explicit actions untagged', () => {
    expect(body('useRegenerateWidgetSecret')).not.toContain('AUTOSAVE')
    expect(body('useMintWidgetInstallCode')).not.toContain('AUTOSAVE')
  })
})

describe('autosave error ownership', () => {
  it('names the server reason when the mutation asks for it', async () => {
    const client = clientWithHandler()
    const mutation = client.getMutationCache().build(client, {
      meta: { ...AUTOSAVE, showServerMessage: true },
      mutationFn: async () => Promise.reject(new Error('Resume the channel before enabling it.')),
    })
    await expect(mutation.execute(undefined)).rejects.toThrow()
    await vi.waitFor(() => expect(toastError).toHaveBeenCalledTimes(1))
    expect(toastError).toHaveBeenCalledWith("Couldn't save. Resume the channel before enabling it.")
  })

  it('keeps the generic message for other autosave failures', async () => {
    const client = clientWithHandler()
    const mutation = client.getMutationCache().build(client, {
      meta: AUTOSAVE,
      mutationFn: async () => Promise.reject(new Error('internal detail')),
    })
    await expect(mutation.execute(undefined)).rejects.toThrow()
    await vi.waitFor(() => expect(toastError).toHaveBeenCalledTimes(1))
    expect(toastError).toHaveBeenCalledWith("Couldn't save. Try again.")
  })

  it('stays silent for an error the page owns, and toasts the rest', async () => {
    const client = clientWithHandler()
    const ownsError = (error: unknown) => error instanceof Error && error.message === 'plan'
    const owned = client.getMutationCache().build(client, {
      meta: { ...AUTOSAVE, ownsError },
      mutationFn: async () => Promise.reject(new Error('plan')),
    })
    await expect(owned.execute(undefined)).rejects.toThrow()
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(toastError).not.toHaveBeenCalled()
    const other = client.getMutationCache().build(client, {
      meta: { ...AUTOSAVE, ownsError },
      mutationFn: async () => Promise.reject(new Error('nope')),
    })
    await expect(other.execute(undefined)).rejects.toThrow()
    await vi.waitFor(() => expect(toastError).toHaveBeenCalledTimes(1))
  })
})
