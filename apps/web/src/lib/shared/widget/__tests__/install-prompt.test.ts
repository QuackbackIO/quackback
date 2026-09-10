import { describe, expect, it } from 'vitest'
import {
  WIDGET_SKILL_RAW,
  buildWidgetInstallPrompt,
  buildWidgetInstallSnippet,
  maskWidgetSecretInPrompt,
} from '../install-prompt'

describe('buildWidgetInstallPrompt', () => {
  it('installs the launcher only by default', () => {
    const prompt = buildWidgetInstallPrompt({
      instanceUrl: 'https://feedback.example.com/',
      widgetSecret: 'wgt_abc123secret',
    })

    expect(prompt).toContain('Instance URL: https://feedback.example.com')
    expect(prompt).toContain('https://feedback.example.com/api/widget/sdk.js')
    expect(prompt).toContain(WIDGET_SKILL_RAW)
    expect(prompt).toContain('Install the launcher only')
    expect(prompt).not.toContain('wgt_abc123secret')
    expect(prompt).not.toContain('QUACKBACK_WIDGET_SECRET')
    expect(prompt).not.toContain('Do not skip identify')
    expect(prompt).not.toContain('No widget secret has been generated yet')
  })

  it('includes the signing secret and identify steps when identify is on', () => {
    const prompt = buildWidgetInstallPrompt({
      instanceUrl: 'https://feedback.example.com/',
      widgetSecret: 'wgt_abc123secret',
      identify: true,
    })

    expect(prompt).toContain('wgt_abc123secret')
    expect(prompt).toContain('host app server-side secret store')
    expect(prompt).toContain('ssoToken')
    expect(prompt).toContain('Once per session')
    expect(prompt).toContain('Never pass raw id/email from the client')
    expect(prompt).not.toContain('QUACKBACK_WIDGET_SECRET')
  })

  it('does not invent a placeholder secret when identify is on but the secret is missing', () => {
    const prompt = buildWidgetInstallPrompt({
      instanceUrl: 'https://feedback.example.com',
      widgetSecret: null,
      identify: true,
    })

    expect(prompt).toContain('Do not invent one')
    expect(prompt).not.toContain('wgt_YOUR_WIDGET_SECRET')
    expect(prompt).not.toContain('after they regenerate it')
  })
})

describe('buildWidgetInstallSnippet', () => {
  it('omits identify by default', () => {
    const snippet = buildWidgetInstallSnippet({
      instanceUrl: 'https://feedback.example.com/',
    })

    expect(snippet).toContain('https://feedback.example.com/api/widget/sdk.js')
    expect(snippet).toContain('Quackback("init")')
    expect(snippet).not.toContain('ssoToken')
    expect(snippet).not.toContain('QUACKBACK_WIDGET_SECRET')
  })

  it('documents identify primitives without assuming a host session API', () => {
    const snippet = buildWidgetInstallSnippet({
      instanceUrl: 'https://feedback.example.com/',
      identify: true,
    })

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
  })
})

describe('maskWidgetSecretInPrompt', () => {
  it('masks the live secret for the on-screen preview', () => {
    const secret = 'wgt_abc123secret'
    const prompt = buildWidgetInstallPrompt({
      instanceUrl: 'https://feedback.example.com',
      widgetSecret: secret,
      identify: true,
    })

    const masked = maskWidgetSecretInPrompt(prompt, secret)
    expect(masked).not.toContain(secret)
    expect(masked).toContain('wgt_abc1••••••••')
  })

  it('leaves launcher-only prompts unchanged', () => {
    const prompt = buildWidgetInstallPrompt({
      instanceUrl: 'https://feedback.example.com',
      widgetSecret: null,
    })
    expect(maskWidgetSecretInPrompt(prompt, null)).toBe(prompt)
  })
})
