// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { SYSTEM_THEME_SCRIPT } from '../index'

// The script a document rendered without the OS preference runs first thing
// in <head>. Whatever it decides is the theme of the first frame, so it must
// agree with what next-themes applies later: the stored choice, else the OS.

function osPrefers(scheme: 'dark' | 'light') {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: query === '(prefers-color-scheme: dark)' && scheme === 'dark',
    }))
  )
}

function run() {
  new Function(SYSTEM_THEME_SCRIPT)()
  const html = document.documentElement
  return { classes: [...html.classList], colorScheme: html.style.colorScheme }
}

beforeEach(() => {
  document.documentElement.className = ''
  document.documentElement.removeAttribute('style')
  localStorage.clear()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('SYSTEM_THEME_SCRIPT', () => {
  it('paints a dark OS dark', () => {
    osPrefers('dark')
    expect(run()).toEqual({ classes: ['dark'], colorScheme: 'dark' })
  })

  it('paints a light OS light', () => {
    osPrefers('light')
    expect(run()).toEqual({ classes: ['light'], colorScheme: 'light' })
  })

  it('follows the OS when the stored choice is system', () => {
    osPrefers('dark')
    localStorage.setItem('theme', 'system')
    expect(run()).toEqual({ classes: ['dark'], colorScheme: 'dark' })
  })

  it('prefers the choice next-themes stored over the OS', () => {
    osPrefers('light')
    localStorage.setItem('theme', 'dark')
    expect(run()).toEqual({ classes: ['dark'], colorScheme: 'dark' })
  })

  it('still follows the OS when storage is blocked', () => {
    osPrefers('dark')
    vi.stubGlobal('localStorage', {
      getItem() {
        throw new DOMException('blocked', 'SecurityError')
      },
    })
    expect(run()).toEqual({ classes: ['dark'], colorScheme: 'dark' })
  })
})
