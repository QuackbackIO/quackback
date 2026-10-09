import { describe, it, expect } from 'vitest'
import { documentLocale, htmlLangDir } from '../document-locale'

// The argument is the matched route-id chain (root -> leaf), as exposed by
// useRouterState's `matches`.
describe('documentLocale', () => {
  it('localizes any page under the portal layout', () => {
    expect(documentLocale(['__root__', '/_portal', '/_portal/'], 'zh-cn')).toBe('zh-cn')
    expect(documentLocale(['__root__', '/_portal', '/_portal/hc'], 'zh-cn')).toBe('zh-cn')
    expect(documentLocale(['__root__', '/_portal', '/_portal/roadmap/'], 'zh-tw')).toBe('zh-tw')
  })
  it('localizes the standalone auth and widget routes', () => {
    expect(documentLocale(['__root__', '/auth/reset-password'], 'zh-cn')).toBe('zh-cn')
    expect(documentLocale(['__root__', '/widget'], 'ar')).toBe('ar')
    expect(documentLocale(['__root__', '/unsubscribe'], 'ar')).toBe('ar')
  })
  it('localizes the AI & Automation pages under settings and the workflow builder', () => {
    for (const id of [
      '/admin/settings/agent',
      '/admin/settings/copilot',
      '/admin/settings/skills',
      '/admin/settings/connectors',
      '/admin/settings/connectors_/$connectorId',
      '/admin/settings/workflows',
      '/admin/settings_/workflows/$workflowId',
    ]) {
      expect(documentLocale(['__root__', '/admin', id], 'zh-cn'), id).toBe('zh-cn')
    }
  })
  it('keeps the other settings pages on the default', () => {
    for (const id of [
      '/admin/settings',
      '/admin/settings/general',
      '/admin/settings/agents',
      '/admin/settings/integrations',
      '/admin/settings/widget',
    ]) {
      expect(documentLocale(['__root__', '/admin', '/admin/settings', id], 'zh-cn'), id).toBe('en')
    }
  })
  it('keeps untranslated auth utility pages on the default locale', () => {
    // These render hard-coded English with no IntlProvider — labeling them
    // `lang="ar" dir="rtl"` would misstate the language and flip the layout.
    expect(documentLocale(['__root__', '/auth/login'], 'ar')).toBe('en')
    expect(documentLocale(['__root__', '/auth/signup'], 'zh-cn')).toBe('en')
    expect(documentLocale(['__root__', '/auth/two-factor'], 'ar')).toBe('en')
    expect(documentLocale(['__root__', '/auth/auth-complete'], 'zh-cn')).toBe('en')
    expect(documentLocale(['__root__', '/auth/widget-handoff'], 'zh-tw')).toBe('en')
  })
  it('keeps the admin app (incl. its English-first login) and system routes on the default', () => {
    // /admin/login renders an English heading + email stage on first paint, so
    // it stays English until that copy is localized.
    expect(documentLocale(['__root__', '/admin/login'], 'ar')).toBe('en')
    expect(documentLocale(['__root__', '/admin/posts'], 'zh-cn')).toBe('en')
    expect(documentLocale(['__root__', '/onboarding'], 'ar')).toBe('en')
    expect(documentLocale(['__root__', '/apps'], 'zh-cn')).toBe('en')
    expect(documentLocale(['__root__', '/verify-magic-link'], 'zh-cn')).toBe('en')
  })
})

describe('htmlLangDir', () => {
  it('emits a canonical BCP-47 lang (upper-cased region subtag)', () => {
    expect(htmlLangDir('zh-cn').lang).toBe('zh-CN')
    expect(htmlLangDir('zh-tw').lang).toBe('zh-TW')
    expect(htmlLangDir('pt-br').lang).toBe('pt-BR')
    expect(htmlLangDir('en').lang).toBe('en') // no region subtag, unchanged
  })
  it('sets dir from the locale', () => {
    expect(htmlLangDir('ar').dir).toBe('rtl')
    expect(htmlLangDir('en').dir).toBe('ltr')
    expect(htmlLangDir('zh-cn').dir).toBe('ltr')
  })
})
