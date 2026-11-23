/**
 * The patch Ask may make to the Customise draft: only the settings on the
 * page, never CSS. Applying it to the editor's draft is tested beside the
 * editor (portal-customise/__tests__/ask-draft.test.ts).
 */
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { applyTabsPatch, portalDraftPatchSchema } from '../draft-patch'

describe('portalDraftPatchSchema', () => {
  it('accepts every setting Ask can reach', () => {
    const result = portalDraftPatchSchema.safeParse({
      themeMode: 'user',
      colours: {
        light: { main: '#1a73e8', background: '#fafaf9', text: '#111827', header: '#0b1f3a' },
        dark: { main: '#8ab4f8', header: 'auto' },
      },
      font: 'lora',
      corners: 0.25,
      buttonShape: 'corners',
      tabs: {
        order: ['roadmap', 'feedback'],
        changes: [
          { id: 'feedback', label: 'Ideas' },
          { id: 'changelog', enabled: true },
        ],
      },
      welcomeMessage: 'Tell us what to build next.',
      helpCenter: {
        homepageTitle: 'Help',
        homepageDescription: 'Guides and answers',
        headerLinks: [{ label: 'Status', url: 'https://status.example.com' }],
      },
    })
    expect(result.success).toBe(true)
  })

  it.each([
    [
      'a CSS declaration smuggled into a colour',
      { colours: { light: { main: 'red; } body { display: none' } } },
    ],
    ['a named colour instead of hex', { colours: { light: { main: 'red' } } }],
    ['an oklch value', { colours: { light: { main: 'oklch(0.5 0.2 250)' } } }],
    ['Advanced CSS', { extraCss: '.x { color: red }' }],
    ['custom CSS under another name', { customCss: 'body { color: red }' }],
    ['a raw theme variable', { light: { primary: '#000000' } }],
    ['an unknown colour role', { colours: { light: { ring: '#000000' } } }],
    ['a header colour that is neither hex nor auto', { colours: { light: { header: 'navy' } } }],
    // A model that fills every optional with null must not clear the header.
    ['a null header colour', { colours: { light: { header: null } } }],
    ['auto for a colour that has no Auto here', { colours: { light: { main: 'auto' } } }],
    ['a font outside the list', { font: 'Comic Sans' }],
    ['a CSS font stack', { font: '"Inter", sans-serif' }],
    ['a corner radius off the stops', { corners: 0.375 }],
    ['a corner radius as CSS', { corners: '1rem' }],
    ['an unknown button shape', { buttonShape: 'circle' }],
    ['a logo key', { logo: { wide: { key: 'header-logos/x.svg' } } }],
    ['an uploaded font', { customFont: { family: 'Brand', files: [], fallback: 'inter' } }],
    ['a new tab with an address', { tabs: { changes: [{ id: 'x', url: 'javascript:alert(1)' }] } }],
    ['a tab type change', { tabs: { changes: [{ id: 'roadmap', type: 'link' }] } }],
    [
      'a tab label over 30 characters',
      { tabs: { changes: [{ id: 'roadmap', label: 'x'.repeat(31) }] } },
    ],
    ['a portal feature toggle', { features: { allowAnonymous: true } }],
    [
      'a javascript: header link',
      { helpCenter: { headerLinks: [{ label: 'x', url: 'javascript:alert(1)' }] } },
    ],
    [
      'more than three header links',
      {
        helpCenter: {
          headerLinks: [1, 2, 3, 4].map((n) => ({ label: `L${n}`, url: `https://e.com/${n}` })),
        },
      },
    ],
    ['a Help Center locale field', { helpCenter: { locales: {} } }],
  ])('rejects %s', (_name, patch) => {
    expect(portalDraftPatchSchema.safeParse(patch).success).toBe(false)
  })

  it('describes itself as JSON Schema, which the prompt-only fallback sends', () => {
    expect(() => z.toJSONSchema(portalDraftPatchSchema)).not.toThrow()
  })
})

describe('applyTabsPatch', () => {
  const nav = [
    { id: 'feedback', type: 'feedback' as const },
    { id: 'roadmap', type: 'roadmap' as const },
    { id: 'changelog', type: 'changelog' as const, enabled: false },
    { id: 'link-1', type: 'link' as const, label: 'Docs', url: 'https://docs.example.com' },
  ]

  it('reorders tabs, listed ones first and the rest in their order', () => {
    const next = applyTabsPatch(nav, { order: ['changelog', 'roadmap'] })
    expect(next.map((t) => t.id)).toEqual(['changelog', 'roadmap', 'feedback', 'link-1'])
  })

  it('ignores unknown and repeated ids in an order', () => {
    const next = applyTabsPatch(nav, { order: ['nope', 'roadmap', 'roadmap'] })
    expect(next.map((t) => t.id)).toEqual(['roadmap', 'feedback', 'changelog', 'link-1'])
  })

  it('renames, hides and shows tabs, keeping their other fields', () => {
    const next = applyTabsPatch(nav, {
      changes: [
        { id: 'roadmap', label: 'Plans', enabled: false },
        { id: 'changelog', enabled: true },
        { id: 'missing', label: 'Ghost' },
      ],
    })
    expect(next).toEqual([
      { id: 'feedback', type: 'feedback' },
      { id: 'roadmap', type: 'roadmap', label: 'Plans', enabled: false },
      { id: 'changelog', type: 'changelog', enabled: true },
      { id: 'link-1', type: 'link', label: 'Docs', url: 'https://docs.example.com' },
    ])
  })

  it('never hides Feedback, which is always on', () => {
    const next = applyTabsPatch(nav, { changes: [{ id: 'feedback', enabled: false }] })
    expect(next[0]!.enabled).not.toBe(false)
  })
})
