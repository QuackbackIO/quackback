import { describe, expect, it } from 'vitest'
import {
  WIDGET_SKILL_RAW,
  buildWidgetInstallPrompt,
  buildWidgetInstallSnippet,
} from '../install-prompt'

describe('buildWidgetInstallPrompt', () => {
  it('always includes redeem instructions and never a wgt_ secret', () => {
    const prompt = buildWidgetInstallPrompt('https://feedback.example.com/', 'qbi_testpairingcode')

    expect(prompt).toContain('Instance URL: https://feedback.example.com')
    expect(prompt).toContain('https://feedback.example.com/api/widget/sdk.js')
    expect(prompt).toContain('POST https://feedback.example.com/api/widget/install-context')
    expect(prompt).toContain('qbi_testpairingcode')
    expect(prompt).toContain(WIDGET_SKILL_RAW)
    expect(prompt).toContain('do not ask the user for the HMAC signing secret')
    expect(prompt).toContain('If this app has login')
    expect(prompt).toContain('signingSecret')
    expect(prompt).toContain('ssoToken')
    expect(prompt).toContain('once per session')
    expect(prompt).toContain('Show on your website')
    expect(prompt).not.toContain('Do not implement identify')
    expect(prompt).not.toContain('with identify on')
    expect(prompt).not.toMatch(/wgt_[A-Za-z0-9]/)
    expect(prompt).not.toContain('QUACKBACK_WIDGET_SECRET')
    expect(prompt).not.toContain('identify-users.md')
  })
})

describe('buildWidgetInstallSnippet', () => {
  it('always documents identify primitives without a live secret', () => {
    const snippet = buildWidgetInstallSnippet('https://feedback.example.com/')

    expect(snippet).toContain('https://feedback.example.com/api/widget/sdk.js')
    expect(snippet).toContain('Quackback("init")')
    expect(snippet).toContain('ssoToken')
    expect(snippet).toContain('Quackback("identify", { ssoToken })')
    expect(snippet).toContain('Quackback("logout")')
    expect(snippet).toContain('Admin → Settings → Widget → Install')
    expect(snippet).toContain('stable unique user id')
    expect(snippet).not.toContain('QUACKBACK_WIDGET_SECRET')
    expect(snippet).not.toContain('Quackback("identify", { id')
    expect(snippet).not.toContain('fetch(')
    expect(snippet).not.toContain('/api/quackback')
    expect(snippet).not.toContain('user.id')
    expect(snippet).not.toMatch(/wgt_[A-Za-z0-9]/)
  })
})
