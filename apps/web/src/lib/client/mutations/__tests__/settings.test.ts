import { beforeEach, describe, expect, it, vi } from 'vitest'

const invalidateQueries = vi.fn()
const setQueryData = vi.fn()
const publishPortalCustomisationFn = vi.fn(
  async (_args: { data: Record<string, unknown> }): Promise<Record<string, unknown>> => ({
    ok: true,
    parts: ['theme'],
    published: {},
  })
)

vi.mock('@tanstack/react-query', async () => {
  const actual =
    await vi.importActual<typeof import('@tanstack/react-query')>('@tanstack/react-query')
  return {
    ...actual,
    useMutation: vi.fn((options: unknown) => options),
    useQueryClient: vi.fn(() => ({ invalidateQueries, setQueryData })),
  }
})

vi.mock('@/lib/server/functions/portal-customise', () => ({ publishPortalCustomisationFn }))

describe('settings config mutations cache invalidation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // invalidateQueries returns a promise; onSuccess must return it so the
    // mutation stays pending until the refetch settles (otherwise a fast
    // navigate-away/back can re-read the still-stale cache via ensureQueryData).
    invalidateQueries.mockResolvedValue(undefined)
  })

  it('useUpdatePortalConfig.onSuccess awaits invalidation of the portalConfig query', async () => {
    const { useUpdatePortalConfig } = await import('../settings')
    const mutation = useUpdatePortalConfig() as { onSuccess?: () => unknown }

    const result = mutation.onSuccess?.()

    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['settings', 'portalConfig'] })
    expect(result).toBeInstanceOf(Promise)
  })

  it('useUpdateModerationDefault.onSuccess awaits invalidation of the portalConfig query', async () => {
    const { useUpdateModerationDefault } = await import('../settings')
    const mutation = useUpdateModerationDefault() as { onSuccess?: () => unknown }

    const result = mutation.onSuccess?.()

    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['settings', 'portalConfig'] })
    expect(result).toBeInstanceOf(Promise)
  })

  it('useUpdateWidgetConfig.onSuccess awaits invalidation of the widgetConfig query', async () => {
    const { useUpdateWidgetConfig } = await import('../settings')
    const mutation = useUpdateWidgetConfig() as { onSuccess?: () => unknown }

    const result = mutation.onSuccess?.()

    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['settings', 'widgetConfig'] })
    expect(result).toBeInstanceOf(Promise)
  })

  it('useRegenerateWidgetSecret.onSuccess writes the new secret then awaits invalidation', async () => {
    const { useRegenerateWidgetSecret } = await import('../settings')
    const mutation = useRegenerateWidgetSecret() as { onSuccess?: (secret: string) => unknown }

    const result = mutation.onSuccess?.('wgt_new')

    expect(setQueryData).toHaveBeenCalledWith(['settings', 'widgetSecret'], 'wgt_new')
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['settings', 'widgetSecret'] })
    expect(result).toBeInstanceOf(Promise)
  })

  it('useUpdateHelpCenterConfig.onSuccess awaits invalidation of the helpCenterConfig query', async () => {
    const { useUpdateHelpCenterConfig } = await import('../settings')
    const mutation = useUpdateHelpCenterConfig() as { onSuccess?: () => unknown }

    const result = mutation.onSuccess?.()

    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['settings', 'helpCenterConfig'] })
    expect(result).toBeInstanceOf(Promise)
  })

  it('usePublishPortalCustomisation leaves plan refusals to the page and names other reasons', async () => {
    const { usePublishPortalCustomisation } = await import('../settings')
    const { meta } = usePublishPortalCustomisation() as unknown as {
      meta: { autosave?: boolean; showServerMessage?: boolean; ownsError?: (e: unknown) => boolean }
    }
    expect(meta.autosave).toBe(true)
    expect(meta.showServerMessage).toBe(true)
    expect(meta.ownsError?.(Object.assign(new Error('x'), { statusCode: 402 }))).toBe(true)
    expect(meta.ownsError?.(new Error('Custom CSS is too long.'))).toBe(false)
  })

  it('usePublishPortalCustomisation sends every part in one call', async () => {
    const { usePublishPortalCustomisation } = await import('../settings')
    const mutation = usePublishPortalCustomisation() as unknown as {
      mutationFn: (input: Record<string, unknown>) => Promise<unknown>
    }
    const input = {
      before: { theme: {}, customCss: '', portal: { nav: null } },
      theme: { themeMode: 'dark' },
      customCss: '.brand { color: red; }',
      portal: { nav: { items: [] } },
    }
    await mutation.mutationFn(input)
    expect(publishPortalCustomisationFn).toHaveBeenCalledOnce()
    expect(publishPortalCustomisationFn).toHaveBeenCalledWith({ data: input })
  })

  it('usePublishPortalCustomisation fails with the server sentence when someone else changed a part', async () => {
    publishPortalCustomisationFn.mockResolvedValueOnce({
      ok: false,
      code: 'SETTINGS_CHANGED',
      message: 'Someone else changed these settings. Reload the page to see their changes.',
      parts: ['portal.nav'],
      current: { portal: { nav: null } },
    })
    const { usePublishPortalCustomisation } = await import('../settings')
    const mutation = usePublishPortalCustomisation() as unknown as {
      mutationFn: (input: Record<string, unknown>) => Promise<unknown>
    }
    await expect(
      mutation.mutationFn({ before: { portal: { nav: null } }, portal: { nav: { items: [] } } })
    ).rejects.toMatchObject({
      message: 'Someone else changed these settings. Reload the page to see their changes.',
      conflict: { code: 'SETTINGS_CHANGED', parts: ['portal.nav'] },
    })
  })

  it('usePublishPortalCustomisation.onSuccess awaits invalidation of what it published', async () => {
    const { usePublishPortalCustomisation } = await import('../settings')
    const mutation = usePublishPortalCustomisation() as unknown as {
      onSuccess?: (data: unknown, variables: Record<string, unknown>) => unknown
    }

    const result = mutation.onSuccess?.(undefined, {
      before: {},
      theme: {},
      customCss: '',
      portal: { nav: { items: [] } },
    })

    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['settings', 'branding'] })
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['settings', 'customCss'] })
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['settings', 'portalConfig'] })
    expect(invalidateQueries).not.toHaveBeenCalledWith({
      queryKey: ['settings', 'helpCenterConfig'],
    })
    expect(result).toBeInstanceOf(Promise)
  })
})
