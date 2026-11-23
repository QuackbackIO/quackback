// @vitest-environment happy-dom
import { StrictMode, type ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { importDeepLinkSite, useImportDeepLink } from '../import-deep-link'

describe('the Customise import deep link', () => {
  it('accepts a website and drops anything else', () => {
    expect(importDeepLinkSite('acme.example')).toBe('acme.example')
    expect(importDeepLinkSite(' https://www.acme.example/about ')).toBe(
      'https://www.acme.example/about'
    )
    for (const bad of [undefined, null, 7, '', '   ', 'javascript:alert(1)', 'ftp://acme.example'])
      expect(importDeepLinkSite(bad), String(bad)).toBeUndefined()
    expect(importDeepLinkSite(`${'a'.repeat(2050)}.example`)).toBeUndefined()
  })

  it('hands the site over once, and clears it from the address at once', () => {
    const clear = vi.fn()
    const { result, rerender } = renderHook(
      ({ site }: { site?: string }) => useImportDeepLink(site, clear),
      { initialProps: { site: 'acme.example' } as { site?: string } }
    )
    expect(clear).toHaveBeenCalledOnce()
    expect(result.current()).toBe('acme.example')
    expect(result.current()).toBeNull()
    // The address no longer carries it; an editor that mounts again gets nothing.
    rerender({ site: undefined })
    expect(result.current()).toBeNull()
    expect(clear).toHaveBeenCalledOnce()
  })

  it('hands nothing over for a value that is no website, and clears that too', () => {
    // The route keeps any string (its check must stay out of every page's
    // script); what a website is gets decided here, where the editor loads.
    for (const bad of ['javascript:alert(1)', 'ftp://acme.example', '   ']) {
      const clear = vi.fn()
      const { result } = renderHook(() => useImportDeepLink(bad, clear))
      expect(result.current(), bad).toBeNull()
      expect(clear, bad).toHaveBeenCalledOnce()
    }
  })

  it('has nothing to hand over for a plain visit', () => {
    const clear = vi.fn()
    const { result } = renderHook(() => useImportDeepLink(undefined, clear))
    expect(result.current()).toBeNull()
    expect(clear).not.toHaveBeenCalled()
  })

  it('still hands it over exactly once when effects run twice', () => {
    const clear = vi.fn()
    const wrapper = ({ children }: { children: ReactNode }) => <StrictMode>{children}</StrictMode>
    const { result } = renderHook(() => useImportDeepLink('acme.example', clear), { wrapper })
    expect([result.current(), result.current()]).toEqual(['acme.example', null])
  })
})
