// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { WidgetConnectionRow } from '../widget-connection-row'

afterEach(cleanup)

const base = {
  hasWidgetInstalled: true,
  widgetOriginHost: 'app.example.com',
  widgetLastDetectedAt: new Date().toISOString(),
  widgetSdkNeedsUpdate: false,
}

describe('WidgetConnectionRow', () => {
  it('shows a Connected badge when the widget is on the site and visible', () => {
    render(<WidgetConnectionRow label="Install status" status={base} enabled />)
    expect(screen.getByText('Install status')).toBeTruthy()
    expect(screen.getByText('Connected')).toBeTruthy()
    expect(screen.getByText(/First request came from app\.example\.com/)).toBeTruthy()
    expect(screen.getByText(/Last detected/)).toBeTruthy()
  })

  it('flags an installed widget that is hidden as needing attention', () => {
    render(<WidgetConnectionRow label="Install status" status={base} enabled={false} />)
    expect(screen.getByText('Needs attention')).toBeTruthy()
    expect(screen.queryByText('Connected')).toBeNull()
  })

  it('flags an outdated embed as needing attention', () => {
    render(
      <WidgetConnectionRow
        label="Install status"
        status={{ ...base, widgetSdkNeedsUpdate: true, widgetSdkVersion: '0.1.0' }}
        enabled
      />
    )
    expect(screen.getByText('Needs attention')).toBeTruthy()
  })

  it('shows no badge before the widget is seen', () => {
    render(
      <WidgetConnectionRow label="Install status" status={{ hasWidgetInstalled: false }} enabled />
    )
    expect(screen.queryByText('Connected')).toBeNull()
    expect(screen.queryByText('Needs attention')).toBeNull()
    expect(screen.getByText(/Not on your site yet/)).toBeTruthy()
  })

  it('says it is waiting when asked to', () => {
    render(
      <WidgetConnectionRow
        label="Widget connection"
        status={{ hasWidgetInstalled: false }}
        enabled
        waiting
      />
    )
    expect(screen.getByText('Waiting for the widget to load…')).toBeTruthy()
  })
})
