import { describe, expect, it } from 'vitest'
import { widgetInstallPresence, widgetOriginVerifiedLabel } from '../widget-origin'

describe('widget origin evidence copy', () => {
  it('names a public hostname without calling it the customer site', () => {
    expect(widgetOriginVerifiedLabel('docs.example.com')).toBe(
      'First request came from docs.example.com.'
    )
  })

  it('does not present loopback as a site to visit', () => {
    expect(widgetOriginVerifiedLabel('127.0.0.1')).toBe('First request came from a local page.')
    expect(widgetOriginVerifiedLabel(null)).toBe(
      'A request from an external page reached the widget.'
    )
  })
})

describe('widgetInstallPresence', () => {
  it('stays idle until a request is observed', () => {
    expect(widgetInstallPresence({ connected: false, enabled: true })).toMatchObject({
      title: 'Not detected yet',
      tone: 'idle',
    })
  })

  it('does not report live while Show on your website is off', () => {
    expect(
      widgetInstallPresence({
        connected: true,
        enabled: false,
        originHost: 'docs.example.com',
      })
    ).toEqual({
      title: 'SDK detected',
      description:
        'First request came from docs.example.com. Turn on Show on your website so visitors can see it.',
      tone: 'detected',
    })
  })

  it('reports connected only when the SDK is observed and the widget is on', () => {
    expect(
      widgetInstallPresence({
        connected: true,
        enabled: true,
        originHost: 'docs.example.com',
      })
    ).toEqual({
      title: 'Widget connected',
      description: 'First request came from docs.example.com.',
      tone: 'live',
    })
  })

  it('reports live for Connect Messenger when the Messages tab is on', () => {
    expect(
      widgetInstallPresence({
        connected: true,
        enabled: true,
        originHost: 'docs.example.com',
        requireChannel: 'messenger',
        channelTab: true,
        channelAvailable: true,
      })
    ).toMatchObject({
      title: 'Widget connected',
      tone: 'live',
    })
  })

  it('does not report live for Connect Messenger while the Messages tab is off', () => {
    expect(
      widgetInstallPresence({
        connected: true,
        enabled: true,
        originHost: 'docs.example.com',
        requireChannel: 'messenger',
        channelTab: false,
        channelAvailable: true,
      })
    ).toEqual({
      title: 'Messages tab is off',
      description:
        'First request came from docs.example.com. Turn on the Messages tab so conversations can start from the widget.',
      tone: 'channel-off',
    })
  })

  it('does not report live for Connect Messenger while Support is off', () => {
    expect(
      widgetInstallPresence({
        connected: true,
        enabled: true,
        originHost: 'docs.example.com',
        requireChannel: 'messenger',
        channelTab: true,
        channelAvailable: false,
      })
    ).toMatchObject({
      title: 'Customer support is off',
      tone: 'channel-off',
    })
  })

  it('offers the Support prerequisite instead of a failing enable switch', () => {
    expect(
      widgetInstallPresence({
        connected: true,
        enabled: false,
        originHost: 'docs.example.com',
        requireChannel: 'messenger',
        channelTab: true,
        channelAvailable: false,
      })
    ).toMatchObject({
      title: 'Customer support is off',
      tone: 'channel-off',
    })
  })

  it('offers create-board instead of a failing enable switch', () => {
    expect(
      widgetInstallPresence({
        connected: true,
        enabled: false,
        originHost: 'docs.example.com',
        requireChannel: 'feedback',
        channelTab: true,
        channelAvailable: false,
      })
    ).toMatchObject({
      title: 'No public board',
      tone: 'channel-off',
    })
  })

  it('does not report live for feedback while the Feedback tab is off', () => {
    expect(
      widgetInstallPresence({
        connected: true,
        enabled: true,
        originHost: 'docs.example.com',
        requireChannel: 'feedback',
        channelTab: false,
        channelAvailable: true,
      })
    ).toMatchObject({
      title: 'Feedback tab is off',
      tone: 'channel-off',
    })
  })

  it('does not report live for feedback without a public board', () => {
    expect(
      widgetInstallPresence({
        connected: true,
        enabled: true,
        originHost: 'docs.example.com',
        requireChannel: 'feedback',
        channelTab: true,
        channelAvailable: false,
      })
    ).toMatchObject({
      title: 'No public board',
      tone: 'channel-off',
    })
  })
})
