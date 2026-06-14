import { beforeEach, describe, expect, it, vi } from 'vitest'

const invalidateQueries = vi.fn()

vi.mock('@tanstack/react-query', async () => {
  const actual =
    await vi.importActual<typeof import('@tanstack/react-query')>('@tanstack/react-query')
  return {
    ...actual,
    useMutation: vi.fn((options: unknown) => options),
    useQueryClient: vi.fn(() => ({ invalidateQueries })),
  }
})

describe('settings config mutations cache invalidation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('useUpdatePortalConfig.onSuccess invalidates the portalConfig query', async () => {
    const { useUpdatePortalConfig } = await import('../settings')
    const mutation = useUpdatePortalConfig() as { onSuccess?: () => void }

    mutation.onSuccess?.()

    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['settings', 'portalConfig'] })
  })

  it('useUpdateModerationDefault.onSuccess invalidates the portalConfig query', async () => {
    const { useUpdateModerationDefault } = await import('../settings')
    const mutation = useUpdateModerationDefault() as { onSuccess?: () => void }

    mutation.onSuccess?.()

    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['settings', 'portalConfig'] })
  })

  it('useUpdateWidgetConfig.onSuccess invalidates the widgetConfig query', async () => {
    const { useUpdateWidgetConfig } = await import('../settings')
    const mutation = useUpdateWidgetConfig() as { onSuccess?: () => void }

    mutation.onSuccess?.()

    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['settings', 'widgetConfig'] })
  })

  it('useRegenerateWidgetSecret.onSuccess invalidates the widgetSecret query', async () => {
    const { useRegenerateWidgetSecret } = await import('../settings')
    const mutation = useRegenerateWidgetSecret() as { onSuccess?: () => void }

    mutation.onSuccess?.()

    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['settings', 'widgetSecret'] })
  })

  it('useUpdateHelpCenterConfig.onSuccess invalidates the helpCenterConfig query', async () => {
    const { useUpdateHelpCenterConfig } = await import('../settings')
    const mutation = useUpdateHelpCenterConfig() as { onSuccess?: () => void }

    mutation.onSuccess?.()

    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['settings', 'helpCenterConfig'] })
  })

  it('useSaveBrandingTheme.onSuccess invalidates both branding and customCss queries', async () => {
    const { useSaveBrandingTheme } = await import('../settings')
    const mutation = useSaveBrandingTheme() as { onSuccess?: () => void }

    mutation.onSuccess?.()

    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['settings', 'branding'] })
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['settings', 'customCss'] })
  })
})
