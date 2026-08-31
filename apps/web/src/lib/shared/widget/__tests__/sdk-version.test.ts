import { describe, expect, it } from 'vitest'
import { SDK_VERSION } from '../../../../../../../packages/widget/src/version'
import {
  CURRENT_WIDGET_SDK_VERSION,
  parseWidgetSdkVersion,
  sdkVersionFromWidgetRequest,
  widgetConnectedStatusLabel,
  widgetSdkNeedsUpdate,
  widgetSdkUpdateDescription,
} from '../sdk-version'

function req(url: string): Request {
  return new Request(url)
}

describe('parseWidgetSdkVersion', () => {
  it('accepts core semver and drops junk', () => {
    expect(parseWidgetSdkVersion('0.1.6')).toBe('0.1.6')
    expect(parseWidgetSdkVersion(' 1.2.3-dev ')).toBe('1.2.3-dev')
    expect(parseWidgetSdkVersion('')).toBeNull()
    expect(parseWidgetSdkVersion('latest')).toBeNull()
    expect(parseWidgetSdkVersion('0.1')).toBeNull()
  })
})

describe('sdkVersionFromWidgetRequest', () => {
  it('treats instance-served sdk.js as current', () => {
    expect(sdkVersionFromWidgetRequest(req('https://app.example/api/widget/sdk.js'), '0.1.6')).toBe(
      '0.1.6'
    )
  })

  it('reads ?sdk= from the config.json ping', () => {
    expect(
      sdkVersionFromWidgetRequest(
        req('https://app.example/api/widget/config.json?sdk=0.1.5'),
        '0.1.6'
      )
    ).toBe('0.1.5')
  })

  it('treats a config.json ping without sdk as unknown', () => {
    expect(
      sdkVersionFromWidgetRequest(req('https://app.example/api/widget/config.json'), '0.1.6')
    ).toBeNull()
  })
})

describe('widgetSdkNeedsUpdate', () => {
  it('flags missing and older versions', () => {
    expect(widgetSdkNeedsUpdate(null, '0.1.6')).toBe(true)
    expect(widgetSdkNeedsUpdate('0.1.5', '0.1.6')).toBe(true)
    expect(widgetSdkNeedsUpdate('0.1.6', '0.1.6')).toBe(false)
    expect(widgetSdkNeedsUpdate('0.2.0', '0.1.6')).toBe(false)
  })
})

describe('copy', () => {
  it('names the connected and update states', () => {
    expect(widgetConnectedStatusLabel({})).toBe('Not detected yet')
    expect(widgetConnectedStatusLabel({ hasWidgetInstalled: true })).toBe('Widget connected')
    expect(
      widgetConnectedStatusLabel({ hasWidgetInstalled: true, widgetSdkNeedsUpdate: true })
    ).toBe('Widget connected · SDK update available')
    expect(widgetSdkUpdateDescription('0.1.5', '0.1.6')).toBe(
      'Installed SDK 0.1.5. Update your embed to 0.1.6.'
    )
  })

  it('re-exports the widget package version', () => {
    expect(CURRENT_WIDGET_SDK_VERSION).toBe(SDK_VERSION)
  })
})
