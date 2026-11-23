// @vitest-environment happy-dom
/**
 * Finding the site's own dark-mode logo beside the logo the measurement
 * took: a picture's dark-scheme source, or a twin image the page marks for
 * dark mode. Only what the site itself serves; nothing is made.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { measureBrandPage } from '../page-measure'
import { findDarkLogo } from '../page-dark-logo'

const original = Element.prototype.getBoundingClientRect
beforeEach(() => {
  Element.prototype.getBoundingClientRect = function () {
    return { top: 10, left: 0, width: 120, height: 30, right: 120, bottom: 40 } as DOMRect
  }
  document.head.innerHTML =
    '<style>* { opacity: 1; background-color: transparent } body { background-color: rgb(255, 255, 255) }</style>'
})
afterEach(() => {
  Element.prototype.getBoundingClientRect = original
  document.body.innerHTML = ''
})
/** The measurement first: it finds the logo and leaves it for this pass. */
const find = (header: string) => {
  document.body.innerHTML = `<header>${header}</header>`
  measureBrandPage()
  return findDarkLogo()
}

describe('findDarkLogo', () => {
  it('takes a picture’s source for a dark system', () => {
    expect(
      find(`<a href="/"><picture>
        <source media="(prefers-color-scheme: dark)" srcset="/logo-white.svg 1x, /logo-white@2x.png 2x">
        <img src="https://acme.example/logo.svg" alt="Acme logo"></picture></a>`)
    ).toEqual({ src: new URL('/logo-white.svg', location.href).href, from: 'picture' })
  })

  it.each([
    [
      'a utility class',
      '<img class="hidden dark:block" src="https://acme.example/b.svg" alt="Acme">',
    ],
    ['a named class', '<img class="logo logo--dark" src="https://acme.example/b.svg" alt="Acme">'],
    [
      'a wrapper’s class',
      '<span class="only-dark"><img src="https://acme.example/b.svg" alt="Acme"></span>',
    ],
    ['an attribute', '<img data-theme="dark" src="https://acme.example/b.svg" alt="Acme">'],
  ])('takes the twin beside the logo that the page marks for dark mode by %s', (_how, twin) => {
    expect(
      find(
        `<a href="/"><img class="block dark:hidden logo" src="https://acme.example/a.svg" alt="Acme logo">${twin}</a>`
      )
    ).toEqual({ src: 'https://acme.example/b.svg', from: 'pair' })
  })

  it('has none for a logo on its own, a twin not marked for dark, or the light one of a pair', () => {
    expect(
      find('<a href="/"><img src="https://acme.example/a.svg" alt="Acme logo"></a>')
    ).toBeNull()
    expect(
      find(`<a href="/"><img src="https://acme.example/a.svg" alt="Acme logo">
        <img class="logo-mobile" src="https://acme.example/m.svg" alt="Acme"></a>`)
    ).toBeNull()
    expect(
      find(`<a href="/"><img src="https://acme.example/a.svg" alt="Acme logo">
        <img class="dark:hidden" src="https://acme.example/l.svg" alt="Acme"></a>`)
    ).toBeNull()
    expect(find('<p>No logo</p>')).toBeNull()
  })

  it('never reaches past the logo’s own corner of the header for a twin', () => {
    expect(
      find(`<div><a href="/"><img src="https://acme.example/a.svg" alt="Acme logo"></a></div>
        <nav><a href="/x">X</a><a href="/partner"><img class="dark" src="https://other.example/p.svg" alt="Partner"></a></nav>`)
    ).toBeNull()
  })
})
