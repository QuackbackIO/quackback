import { describe, expect, it } from 'vitest'
import { widgetActivationConfig } from '../settings.widget'
import { DEFAULT_WIDGET_CONFIG } from '../settings.types'
import { ValidationError } from '@/lib/shared/errors'

describe('widgetActivationConfig', () => {
  it('enables Messenger and its Messages tab together without losing other config', () => {
    const config = widgetActivationConfig(
      {
        ...DEFAULT_WIDGET_CONFIG,
        launcherLabel: 'Talk to us',
        tabs: { feedback: false, changelog: true },
      },
      'messenger'
    )

    expect(config).toMatchObject({
      enabled: true,
      launcherLabel: 'Talk to us',
      tabs: { feedback: false, changelog: true, messenger: true },
      messenger: { enabled: true },
    })
    expect(config.defaultBoard).toBeUndefined()
  })

  it('enables feedback and selects the existing public board', () => {
    expect(widgetActivationConfig(DEFAULT_WIDGET_CONFIG, 'feedback', 'ideas')).toMatchObject({
      enabled: true,
      defaultBoard: 'ideas',
      tabs: { feedback: true },
    })
  })

  it('refuses feedback activation without a public board', () => {
    expect(() => widgetActivationConfig(DEFAULT_WIDGET_CONFIG, 'feedback')).toThrow(ValidationError)
    expect(() => widgetActivationConfig(DEFAULT_WIDGET_CONFIG, 'feedback')).toThrow(
      /public feedback board/i
    )
  })
})
