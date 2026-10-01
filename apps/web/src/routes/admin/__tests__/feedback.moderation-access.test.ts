import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/server/functions/moderation', () => ({
  approvePostFn: vi.fn(),
  rejectPostFn: vi.fn(),
  approveCommentFn: vi.fn(),
  rejectCommentFn: vi.fn(),
}))

const { Route } = await import('../feedback.moderation')

type BeforeLoad = (args: { context: { permissions?: string[] } }) => unknown
const beforeLoad = (Route as unknown as { options: { beforeLoad?: BeforeLoad } }).options.beforeLoad

function run(permissions?: string[]) {
  try {
    beforeLoad?.({ context: { permissions } })
  } catch (thrown) {
    return thrown as { options?: { to?: string } }
  }
  return null
}

describe('/admin/feedback/moderation access', () => {
  it('defines a permission guard', () => {
    expect(beforeLoad).toBeTypeOf('function')
  })

  it('denies a teammate without post.approve', () => {
    expect(run(['post.view'])).not.toBeNull()
    expect(run(undefined)).not.toBeNull()
  })

  it('admits a teammate with post.approve', () => {
    expect(run(['post.approve'])).toBeNull()
  })
})
