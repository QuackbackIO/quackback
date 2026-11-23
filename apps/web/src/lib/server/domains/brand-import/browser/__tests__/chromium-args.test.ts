/**
 * The flags the reader starts Chromium with: every request through the guard
 * proxy, Chromium's own sandbox on, and site isolation left as Chromium has
 * it. Only an operator who says so turns the sandbox off.
 */
import { describe, expect, it } from 'vitest'
import { chromiumArgs } from '../read-page'

describe('chromiumArgs', () => {
  it('sends every request through the guard proxy, loopback included', () => {
    const args = chromiumArgs(41234, {})
    expect(args).toContain('--proxy-server=http://127.0.0.1:41234')
    expect(args).toContain('--proxy-bypass-list=<-loopback>')
  })

  it('keeps the sandbox and site isolation', () => {
    const args = chromiumArgs(41234, {})
    expect(args).not.toContain('--no-sandbox')
    expect(args.join(' ')).not.toMatch(/site-isolation|site-per-process|IsolateOrigins/)
  })

  it('turns the sandbox off only when the operator says so', () => {
    expect(chromiumArgs(1, { QUACKBACK_BROWSER_SANDBOX: 'off' })).toContain('--no-sandbox')
    expect(chromiumArgs(1, { QUACKBACK_BROWSER_SANDBOX: 'on' })).not.toContain('--no-sandbox')
  })
})
