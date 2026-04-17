import { describe, it, expect } from 'vitest'
import { buildWidgetSDK } from '../sdk-template'

describe('buildWidgetSDK', () => {
  it('should return a string', () => {
    const result = buildWidgetSDK('https://feedback.acme.com')
    expect(typeof result).toBe('string')
  })

  it('should embed the base URL in the output', () => {
    const result = buildWidgetSDK('https://feedback.acme.com')
    expect(result).toContain('"https://feedback.acme.com"')
  })

  it('should contain the widget URL', () => {
    const result = buildWidgetSDK('https://feedback.acme.com')
    expect(result).toContain('BASE_URL + "/widget"')
  })

  it('should be a valid IIFE', () => {
    const result = buildWidgetSDK('https://feedback.acme.com')
    expect(result).toMatch(/^\(function\(\)/)
    expect(result).toMatch(/\}\)\(\);$/)
  })

  it('should include the command dispatcher', () => {
    const result = buildWidgetSDK('https://feedback.acme.com')
    expect(result).toContain('function dispatch(command, options, extra)')
  })

  it('should handle the init command', () => {
    const result = buildWidgetSDK('https://feedback.acme.com')
    expect(result).toContain('"init"')
  })

  it('should handle identify command', () => {
    const result = buildWidgetSDK('https://feedback.acme.com')
    expect(result).toContain('"identify"')
    expect(result).toContain('"quackback:identify"')
  })

  it('should handle open/close/destroy commands', () => {
    const result = buildWidgetSDK('https://feedback.acme.com')
    expect(result).toContain('"open"')
    expect(result).toContain('"close"')
    expect(result).toContain('"destroy"')
  })

  it('should handle the logout command', () => {
    const result = buildWidgetSDK('https://feedback.acme.com')
    expect(result).toContain('case "logout"')
  })

  it('treats identify() with no args as anonymous', () => {
    const result = buildWidgetSDK('https://feedback.acme.com')
    expect(result).toContain('{ anonymous: true }')
  })

  it('bundles identity inside init when config.identity is provided', () => {
    const result = buildWidgetSDK('https://feedback.acme.com')
    expect(result).toContain('config.identity !== undefined')
  })

  it('init shows the widget and defaults to anonymous identity', () => {
    const result = buildWidgetSDK('https://feedback.acme.com')
    // init creates the launcher and starts anonymous unless identity is bundled
    expect(result).toMatch(/case "init"[\s\S]*createLauncher\(\)/)
    expect(result).toMatch(/case "init"[\s\S]*anonymous: true/)
  })

  it('logout keeps the launcher visible (widget stays alive)', () => {
    const result = buildWidgetSDK('https://feedback.acme.com')
    // The logout case should not hide the launcher
    const logoutBlock = result.match(/case "logout":[\s\S]*?break;/)
    expect(logoutBlock).not.toBeNull()
    expect(logoutBlock![0]).not.toContain('launcher.style.display = "none"')
  })

  it('should replay the command queue on initialization', () => {
    const result = buildWidgetSDK('https://feedback.acme.com')
    expect(result).toContain('window.Quackback')
    expect(result).toContain('Quackback.q')
  })

  it('should replay queued commands with the third argument', () => {
    const result = buildWidgetSDK('https://feedback.acme.com')
    expect(result).toContain('dispatch(queue[i][0], queue[i][1], queue[i][2]);')
  })

  it('should set correct iframe sandbox attributes', () => {
    const result = buildWidgetSDK('https://feedback.acme.com')
    expect(result).toContain('allow-scripts allow-forms allow-same-origin allow-popups')
  })

  it('should validate postMessage origin', () => {
    const result = buildWidgetSDK('https://feedback.acme.com')
    expect(result).toContain('event.origin !== BASE_URL')
  })

  it('should handle postMessage types with quackback namespace', () => {
    const result = buildWidgetSDK('https://feedback.acme.com')
    expect(result).toContain('"quackback:ready"')
    expect(result).toContain('"quackback:close"')
    expect(result).toContain('"quackback:navigate"')
    expect(result).toContain('"quackback:identify-result"')
  })

  it('should escape special characters in base URL', () => {
    const result = buildWidgetSDK('https://example.com/path?a=1&b=2')
    // JSON.stringify handles proper escaping
    expect(result).toContain('"https://example.com/path?a=1&b=2"')
  })

  it('should create launcher button with accessibility attributes', () => {
    const result = buildWidgetSDK('https://feedback.acme.com')
    expect(result).toContain('aria-label')
    expect(result).toContain('aria-expanded')
    expect(result).toContain('Open feedback widget')
  })

  it('should set panel iframe title', () => {
    const result = buildWidgetSDK('https://feedback.acme.com')
    expect(result).toContain('Feedback Widget')
  })

  it('should add CSS classes to iframe wrapper and iframe', () => {
    const result = buildWidgetSDK('https://feedback.acme.com')
    expect(result).toContain('quackback-widget-iframe-wrapper')
    expect(result).toContain('quackback-widget-iframe')
  })

  it('should support mobile detection', () => {
    const result = buildWidgetSDK('https://feedback.acme.com')
    expect(result).toContain('window.innerWidth < 640')
  })

  it('positions desktop panel above the launcher button (bottom: 88px)', () => {
    const result = buildWidgetSDK('https://feedback.acme.com')
    // Panel must be offset above the launcher (24px margin + 56px launcher + 8px gap)
    expect(result).toContain('bottom:88px')
  })

  it('defines CHAT_ICON and CLOSE_ICON variables for icon swap', () => {
    const result = buildWidgetSDK('https://feedback.acme.com')
    expect(result).toContain('var CHAT_ICON =')
    expect(result).toContain('var CLOSE_ICON =')
  })

  it('fades CLOSE_ICON in when panel opens on desktop', () => {
    const result = buildWidgetSDK('https://feedback.acme.com')
    // Icon swap uses CSS opacity/transform transitions on separate icon elements
    expect(result).toContain('iconClose.style.opacity = "1"')
    expect(result).toContain('iconChat.style.opacity = "0"')
  })

  it('fades CHAT_ICON in when panel closes on desktop', () => {
    const result = buildWidgetSDK('https://feedback.acme.com')
    expect(result).toContain('iconChat.style.opacity = "1"')
    expect(result).toContain('iconClose.style.opacity = "0"')
  })

  it('hides launcher on mobile when panel opens (conditional on isMobile)', () => {
    const result = buildWidgetSDK('https://feedback.acme.com')
    // Mobile still hides launcher since full-screen panel covers it — must be conditional
    expect(result).toContain('if (isMobile) {')
    expect(result).toContain('launcher.style.display = "none"')
  })

  it('launcher click dispatches close when panel is open', () => {
    const result = buildWidgetSDK('https://feedback.acme.com')
    expect(result).toContain('if (isOpen) dispatch("close")')
  })

  it('sets aria-label to "Close feedback widget" when panel opens on desktop', () => {
    const result = buildWidgetSDK('https://feedback.acme.com')
    expect(result).toContain('Close feedback widget')
  })
})
