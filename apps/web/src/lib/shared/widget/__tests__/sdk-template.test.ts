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
    expect(result).toContain('function dispatch(command, options)')
  })

  it('should handle the initialize_feedback_widget command', () => {
    const result = buildWidgetSDK('https://feedback.acme.com')
    expect(result).toContain('"initialize_feedback_widget"')
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

  it('should replay the command queue on initialization', () => {
    const result = buildWidgetSDK('https://feedback.acme.com')
    expect(result).toContain('window.Quackback')
    expect(result).toContain('Quackback.q')
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

  it('should create trigger button with accessibility attributes', () => {
    const result = buildWidgetSDK('https://feedback.acme.com')
    expect(result).toContain('aria-label')
    expect(result).toContain('aria-expanded')
    expect(result).toContain('Open feedback widget')
  })

  it('should set panel iframe title', () => {
    const result = buildWidgetSDK('https://feedback.acme.com')
    expect(result).toContain('Feedback Widget')
  })

  it('should support mobile detection', () => {
    const result = buildWidgetSDK('https://feedback.acme.com')
    expect(result).toContain('window.innerWidth < 640')
  })
})
