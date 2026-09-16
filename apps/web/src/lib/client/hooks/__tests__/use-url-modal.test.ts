// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useUrlModal } from '../use-url-modal'

const navigate = vi.fn()

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigate,
}))

describe('useUrlModal', () => {
  it('closes to the current pathname instead of a hard-coded product route', () => {
    const { result } = renderHook(() =>
      useUrlModal({
        urlId: 'changelog_01h455vb4pex5vsknk084sn02q',
        idPrefix: 'changelog',
        searchParam: 'entry',
        route: '/admin',
        search: { entry: 'changelog_01h455vb4pex5vsknk084sn02q' },
      })
    )

    act(() => {
      result.current.close()
    })

    expect(navigate).toHaveBeenCalledWith({
      to: '/admin',
      search: {},
      replace: true,
    })
  })
})
