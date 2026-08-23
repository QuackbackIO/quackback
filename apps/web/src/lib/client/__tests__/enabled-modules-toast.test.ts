import { beforeEach, describe, expect, it, vi } from 'vitest'

const success = vi.fn()
vi.mock('sonner', () => ({ toast: { success } }))

const { toastEnabledModules } = await import('../enabled-modules-toast')

describe('toastEnabledModules', () => {
  beforeEach(() => success.mockClear())

  it('is silent when nothing new turned on', () => {
    toastEnabledModules([])
    expect(success).not.toHaveBeenCalled()
  })

  it('names a single newly enabled product', () => {
    toastEnabledModules(['Help Center'])
    expect(success).toHaveBeenCalledWith('Help Center turned on')
  })

  it('lists several newly enabled products', () => {
    toastEnabledModules(['Help Center', 'Support'])
    expect(success).toHaveBeenCalledWith('Turned on Help Center, Support')
  })
})
