import { describe, expect, it } from 'vitest'
import {
  WIDGET_SECRET_ENV,
  WIDGET_SECRET_PLACEHOLDER,
  WIDGET_SKILL_RAW,
  buildWidgetInstallPrompt,
  buildWidgetInstallSnippet,
  maskWidgetSecretInPrompt,
} from '../install-prompt'

describe('buildWidgetInstallPrompt', () => {
  it('points the agent at the public skill and includes verified identify rules', () => {
    const prompt = buildWidgetInstallPrompt({
      instanceUrl: 'https://feedback.example.com/',
      widgetSecret: 'wgt_abc123secret',
    })

    expect(prompt).toContain('Instance URL: https://feedback.example.com')
    expect(prompt).toContain('https://feedback.example.com/api/widget/sdk.js')
    expect(prompt).toContain('wgt_abc123secret')
    expect(prompt).toContain(WIDGET_SECRET_ENV)
    expect(prompt).toContain(WIDGET_SKILL_RAW)
    expect(prompt).toContain('ssoToken')
    expect(prompt).toContain('Once per session')
    expect(prompt).toContain('Never pass raw id/email from the client')
  })

  it('uses a placeholder when no secret has been generated', () => {
    const prompt = buildWidgetInstallPrompt({
      instanceUrl: 'https://feedback.example.com',
      widgetSecret: null,
    })

    expect(prompt).toContain(WIDGET_SECRET_PLACEHOLDER)
    expect(prompt).toContain('No widget secret has been generated yet')
  })
})

describe('buildWidgetInstallSnippet', () => {
  it('includes verified identify with the host user id by default', () => {
    const snippet = buildWidgetInstallSnippet({
      instanceUrl: 'https://feedback.example.com/',
    })

    expect(snippet).toContain('https://feedback.example.com/api/widget/sdk.js')
    expect(snippet).toContain('Quackback("init")')
    expect(snippet).toContain('String(user.id)')
    expect(snippet).toContain('ssoToken')
    expect(snippet).toContain('Quackback("identify"')
    expect(snippet).toContain('Quackback("logout")')
    expect(snippet).toContain(WIDGET_SECRET_ENV)
    expect(snippet).not.toContain('Quackback("identify", { id')
  })

  it('omits identify when the switch is off', () => {
    const snippet = buildWidgetInstallSnippet({
      instanceUrl: 'https://feedback.example.com',
      identify: false,
    })

    expect(snippet).toContain('Quackback("init")')
    expect(snippet).not.toContain('ssoToken')
    expect(snippet).not.toContain('user.id')
  })
})

describe('maskWidgetSecretInPrompt', () => {
  it('masks the live secret for the on-screen preview', () => {
    const secret = 'wgt_abc123secret'
    const prompt = buildWidgetInstallPrompt({
      instanceUrl: 'https://feedback.example.com',
      widgetSecret: secret,
    })

    const masked = maskWidgetSecretInPrompt(prompt, secret)
    expect(masked).not.toContain(secret)
    expect(masked).toContain('wgt_abc1••••••••')
  })

  it('leaves placeholder prompts unchanged', () => {
    const prompt = buildWidgetInstallPrompt({
      instanceUrl: 'https://feedback.example.com',
      widgetSecret: null,
    })
    expect(maskWidgetSecretInPrompt(prompt, null)).toBe(prompt)
  })
})
