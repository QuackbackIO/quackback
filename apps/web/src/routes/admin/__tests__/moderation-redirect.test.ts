import { describe, expect, it } from 'vitest'

type BeforeLoad = () => unknown

async function redirectFrom(path: string) {
  const { Route } = await import(/* @vite-ignore */ path)
  const beforeLoad = (Route as { options: { beforeLoad?: BeforeLoad } }).options.beforeLoad
  try {
    beforeLoad?.()
  } catch (thrown) {
    return thrown as { options?: { to?: string }; isRedirect?: boolean }
  }
  return null
}

describe('/admin/moderation', () => {
  it('redirects to the moderation queue inside the Feedback area', async () => {
    const thrown = await redirectFrom('@/routes/admin/moderation')
    expect(thrown?.options?.to).toBe('/admin/feedback/moderation')
  })
})
