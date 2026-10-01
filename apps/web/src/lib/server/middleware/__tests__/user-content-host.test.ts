// @vitest-environment node
/**
 * With `USER_CONTENT_URL` set, the user-content host serves stored files and
 * nothing else: a request on it reaches only GET, HEAD and OPTIONS under
 * /api/storage/. Pages, server functions, uploads and every other route
 * answer 404 there, so a file served from that host can never call the app
 * as if it were the app.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockConfig = vi.hoisted(() => ({
  baseUrl: 'https://app.example.com',
  userContentUrl: undefined as string | undefined,
}))
vi.mock('@/lib/server/config', () => ({ config: mockConfig }))

const { handleUserContentHost, userContentHostMiddleware } = await import('../user-content-host')

const FILES = 'https://files.example.com'
const PASSED = new Response('passed')

function request(url: string, method = 'GET', headers: Record<string, string> = {}): Request {
  const host = new URL(url).host
  return new Request(url, { method, headers: { host, ...headers } })
}

async function answer(req: Request): Promise<Response> {
  const result = await handleUserContentHost({
    request: req,
    next: async () => ({ response: PASSED }),
  })
  return result instanceof Response ? result : result.response!
}

beforeEach(() => {
  mockConfig.baseUrl = 'https://app.example.com'
  mockConfig.userContentUrl = undefined
})

describe('handleUserContentHost', () => {
  it('lets every request through when no user-content host is configured', async () => {
    expect(await answer(request(`${FILES}/admin`))).toBe(PASSED)
    expect(await answer(request(`${FILES}/api/storage/files/a.pdf`, 'PUT'))).toBe(PASSED)
  })

  describe('with a user-content host', () => {
    beforeEach(() => {
      mockConfig.userContentUrl = FILES
    })

    it('serves stored files to GET, HEAD and OPTIONS', async () => {
      for (const method of ['GET', 'HEAD', 'OPTIONS']) {
        expect(await answer(request(`${FILES}/api/storage/files/a.pdf?read=x`, method))).toBe(
          PASSED
        )
      }
    })

    it('answers 404 to everything else on that host', async () => {
      const refused: Array<[string, string]> = [
        ['GET', '/'],
        ['GET', '/admin/inbox'],
        ['POST', '/_serverFn/abc'],
        ['POST', '/api/upload/file?name=a.pdf'],
        ['GET', '/api/widget/config'],
        ['PUT', '/api/storage/files/a.pdf'],
        ['POST', '/api/storage/files/a.pdf'],
        ['DELETE', '/api/storage/files/a.pdf'],
        ['GET', '/api/storage/'],
        ['GET', '/api/storagex/a.pdf'],
      ]
      for (const [method, path] of refused) {
        const res = await answer(request(`${FILES}${path}`, method))
        expect(res.status, `${method} ${path}`).toBe(404)
      }
    })

    it('knows the host behind a proxy and with an explicit default port', async () => {
      const proxied = request('http://web.internal:3000/admin', 'GET', {
        'x-forwarded-host': 'files.example.com',
      })
      expect((await answer(proxied)).status).toBe(404)
      const ported = request('https://app.example.com/admin', 'GET', {
        host: 'files.example.com:443',
      })
      expect((await answer(ported)).status).toBe(404)
    })

    it('leaves the app host alone', async () => {
      expect(await answer(request('https://app.example.com/admin'))).toBe(PASSED)
      expect(await answer(request('https://app.example.com/api/upload/file', 'POST'))).toBe(PASSED)
    })

    it('restricts nothing when the user-content host is the app host itself', async () => {
      mockConfig.userContentUrl = 'https://app.example.com'
      expect(await answer(request('https://app.example.com/admin'))).toBe(PASSED)
    })
  })
})

describe('registration', () => {
  it('runs right after request context, before anything that reads a session or a body', async () => {
    const { startInstance } = await import('@/start')
    const { requestContextMiddleware } = await import('../request-context')
    const options = await startInstance.getOptions()
    expect(options.requestMiddleware?.slice(0, 2)).toEqual([
      requestContextMiddleware,
      userContentHostMiddleware,
    ])
  })
})
