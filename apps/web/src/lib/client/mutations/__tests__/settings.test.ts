import { beforeEach, describe, expect, it, vi } from 'vitest'

const invalidateQueries = vi.fn()
const updateThemeFn = vi.fn(async () => ({ ok: true }))
const updateCustomCssFn = vi.fn(async () => ({ ok: true }))

vi.mock('@tanstack/react-query', async () => {
  const actual =
    await vi.importActual<typeof import('@tanstack/react-query')>('@tanstack/react-query')
  return {
    ...actual,
    useMutation: vi.fn((options: unknown) => options),
    useQueryClient: vi.fn(() => ({ invalidateQueries })),
  }
})

vi.mock('@/lib/server/functions/settings', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/functions/settings')>()),
  updateThemeFn,
  updateCustomCssFn,
}))

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

  it('useRegenerateWidgetSecret.onSuccess awaits invalidation of the widgetSecret query', async () => {
    const { useRegenerateWidgetSecret } = await import('../settings')
    const mutation = useRegenerateWidgetSecret() as { onSuccess?: () => unknown }

    const result = mutation.onSuccess?.()

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

  it('useSaveBrandingTheme persist/clear/rewrite customCss writes', async () => {
    const { useSaveBrandingTheme } = await import('../settings')
    const mutation = useSaveBrandingTheme() as unknown as {
      mutationFn: (input: {
        brandingConfig: Record<string, unknown>
        customCss: string
        customCssWrite: 'persist' | 'clear' | 'rewrite'
      }) => Promise<unknown>
    }

    await mutation.mutationFn({
      brandingConfig: { preset: 'default' },
      customCss: '.brand { color: red; }',
      customCssWrite: 'rewrite',
    })
    expect(updateThemeFn).toHaveBeenCalledOnce()
    expect(updateCustomCssFn).toHaveBeenCalledWith({
      data: { customCss: '.brand { color: red; }' },
    })

    await mutation.mutationFn({
      brandingConfig: { preset: 'default' },
      customCss: ':root { --primary: red; }',
      customCssWrite: 'clear',
    })
    expect(updateCustomCssFn).toHaveBeenCalledWith({ data: { customCss: '' } })

    await mutation.mutationFn({
      brandingConfig: { preset: 'default' },
      customCss: '.brand { color: red; }',
      customCssWrite: 'persist',
    })
    expect(updateCustomCssFn).toHaveBeenCalledWith({
      data: { customCss: '.brand { color: red; }' },
    })
  })

  it('useSaveBrandingTheme.onSuccess awaits invalidation of branding and customCss queries', async () => {
    const { useSaveBrandingTheme } = await import('../settings')
    const mutation = useSaveBrandingTheme() as { onSuccess?: () => unknown }

    const result = mutation.onSuccess?.()

    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['settings', 'branding'] })
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['settings', 'customCss'] })
    expect(result).toBeInstanceOf(Promise)
  })
})
