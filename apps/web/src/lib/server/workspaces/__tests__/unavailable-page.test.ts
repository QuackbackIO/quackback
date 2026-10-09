import { afterEach, describe, expect, it, vi } from 'vitest'
import { unavailableResponse } from '../unavailable-page'

const browser = () =>
  new Request('https://t1.example.com/', {
    headers: { accept: 'text/html,application/xhtml+xml', 'sec-fetch-dest': 'document' },
  })

describe('unavailableResponse', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('points whoever runs the workspace at the control plane when it is configured', async () => {
    vi.stubEnv('QUACKBACK_CONTROL_PLANE_URL', 'https://app.example.com/')
    const res = unavailableResponse(browser(), 'paused', { status: 503, host: 't1.example.com' })
    const html = await res.text()
    expect(html).toContain('href="https://app.example.com/login"')
    expect(html).toContain('Sign in to Quackback')
    expect(html).toContain('This workspace is paused')
  })

  it('leaves the sign-in line out where there is no control plane, as on a self-hosted install', async () => {
    vi.stubEnv('QUACKBACK_CONTROL_PLANE_URL', '')
    const html = await unavailableResponse(browser(), 'deleted', {
      status: 404,
      host: 't1.example.com',
    }).text()
    expect(html).not.toContain('Sign in to Quackback')
    expect(html).toContain('t1.example.com has been deleted by the team that ran it.')
  })

  it('never links to a control plane that is not https', async () => {
    vi.stubEnv('QUACKBACK_CONTROL_PLANE_URL', 'http://app.example.com')
    const html = await unavailableResponse(browser(), 'unknown', {
      status: 404,
      host: 't1.example.com',
    }).text()
    expect(html).not.toContain('http://app.example.com')
  })

  it('keeps one line of text for clients that asked for neither HTML nor JSON', async () => {
    const res = unavailableResponse(new Request('https://t1.example.com/api/x'), 'unknown', {
      status: 404,
      host: 't1.example.com',
    })
    expect(res.headers.get('content-type')).toContain('text/plain')
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(await res.text()).toBe("There's no workspace here.")
  })

  it('treats a widget iframe as a page', async () => {
    const res = unavailableResponse(
      new Request('https://t1.example.com/widget', { headers: { 'sec-fetch-dest': 'iframe' } }),
      'paused',
      { status: 503, host: 't1.example.com' }
    )
    expect(res.headers.get('content-type')).toContain('text/html')
  })
})
