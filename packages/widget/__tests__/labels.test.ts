import { describe, expect, it } from 'vitest'
import { launcherLabels, panelTitle } from '../src/core/labels'

describe('labels for a locale', () => {
  it.each(['constructor', 'toString', '__proto__', 'hasOwnProperty'])(
    'reads %s as an unknown language',
    (locale) => {
      expect(launcherLabels(locale).open).toBe('Open help')
      expect(panelTitle(locale)).toBe('Help')
    }
  )

  it('reads an underscore tag like a hyphen one', () => {
    expect(launcherLabels('pt_BR').open).toBe('Abrir ajuda')
    expect(launcherLabels('zh_TW').open).toBe('開啟說明')
  })

  it.each(['zh-Hant', 'zh-HK', 'zh-MO', 'zh-Hant-HK', 'zh-hant-tw', 'zh_HK'])(
    'gives %s the traditional Chinese names',
    (locale) => {
      expect(launcherLabels(locale).open).toBe('開啟說明')
      expect(panelTitle(locale)).toBe('說明')
    }
  )

  it.each(['zh', 'zh-CN', 'zh-Hans', 'zh-SG'])(
    'gives %s the simplified Chinese names',
    (locale) => {
      expect(launcherLabels(locale).open).toBe('打开帮助')
    }
  )
})
