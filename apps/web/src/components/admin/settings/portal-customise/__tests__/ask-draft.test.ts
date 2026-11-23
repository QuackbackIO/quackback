/**
 * Ask against the editor's own draft: a patch is applied through the same
 * writes the sections use (colours through the colour setters, a listed font
 * replacing an uploaded one, corners), never touching Advanced CSS; and the
 * draft is summarised for the request without CSS, logo keys or font files.
 */
import { describe, expect, it } from 'vitest'
import type { LoadedPortal, PortalDraft } from '../portal-draft'
import {
  draftFont,
  draftFromLoaded,
  draftPalette,
  draftRadius,
  draftRemainder,
} from '../portal-draft'
import { askDraftContextSchema } from '@/lib/shared/portal-customise/ask'
import { applyDraftPatch, summariseDraftForAsk } from '../ask-draft'

const OWN_RULE = '.portal-header { background: linear-gradient(red, blue); }'
const LORA = '"Lora", ui-serif, Georgia, serif'

function loaded(overrides: Partial<LoadedPortal> = {}): LoadedPortal {
  return {
    theme: {
      themeMode: 'light',
      light: { primary: '#2563eb', background: '#ffffff', foreground: '#0a0a0a', radius: '0.5rem' },
      dark: { primary: '#2563eb', background: '#0a0a0a', foreground: '#fafafa', radius: '0.5rem' },
    },
    customCss: OWN_RULE,
    portal: {
      nav: {
        items: [
          { id: 'feedback', type: 'feedback' },
          { id: 'roadmap', type: 'roadmap' },
          { id: 'changelog', type: 'changelog', enabled: false },
          { id: 'link-1', type: 'link', label: 'Docs', url: 'https://docs.example.com' },
        ],
      },
      welcomeCard: { body: { type: 'doc', content: [{ type: 'paragraph' }] } },
    } as LoadedPortal['portal'],
    helpCenter: {
      homepageTitle: 'How can we help?',
      homepageDescription: '',
      headerLinks: [],
    } as unknown as LoadedPortal['helpCenter'],
    ...overrides,
  }
}

const draft = (overrides: Partial<LoadedPortal> = {}): PortalDraft =>
  draftFromLoaded(loaded(overrides))
const ids = (d: PortalDraft) =>
  d.nav
    .filter((t) => ['feedback', 'roadmap', 'changelog', 'link-1'].includes(t.id))
    .map((t) => t.id)

describe('applyDraftPatch on the editor draft', () => {
  it('leaves the draft as it was for an empty patch', () => {
    const before = draft()
    expect(applyDraftPatch(before, {})).toEqual(before)
  })

  it('sets the theme mode and button shape', () => {
    const next = applyDraftPatch(draft(), { themeMode: 'user', buttonShape: 'corners' })
    expect(next.themeMode).toBe('user')
    expect(next.buttonShape).toBe('corners')
  })

  it('sets the main colour', () => {
    const next = applyDraftPatch(draft(), { colours: { light: { main: '#1a73e8' } } })
    expect(draftPalette(next, 'light').primary).toBe('#1a73e8')
  })

  it('sets the header colour, and puts it back on Auto', () => {
    const navy = applyDraftPatch(draft(), { colours: { light: { header: '#0b1f3a' } } })
    expect(draftPalette(navy, 'light').header).toBe('#0b1f3a')
    expect(draftPalette(navy, 'dark').header).toBeUndefined()
    const auto = applyDraftPatch(navy, { colours: { light: { header: 'auto' } } })
    expect(draftPalette(auto, 'light').header).toBeUndefined()
    // Advanced CSS is carried over either way.
    expect(draftRemainder(auto)).toBe(draftRemainder(draft()))
  })

  it('brings derived colours along with a background, as the Colours section does', () => {
    const before = draft()
    const next = applyDraftPatch(before, { colours: { light: { background: '#f8f6f1' } } })
    expect(draftPalette(next, 'light').background).toBe('#f8f6f1')
    expect(draftPalette(next, 'light').card).not.toBe(draftPalette(before, 'light').card)
  })

  it('keeps a text colour given with a background in the same patch', () => {
    const next = applyDraftPatch(draft(), {
      colours: { light: { background: '#0b1220', text: '#e5e7eb' } },
    })
    expect(draftPalette(next, 'light').foreground).toBe('#e5e7eb')
  })

  it('lets a dark main colour win over the one that follows the light colour', () => {
    const next = applyDraftPatch(draft(), {
      colours: { light: { main: '#1a73e8' }, dark: { main: '#8ab4f8' } },
    })
    expect(draftPalette(next, 'dark').primary).toBe('#8ab4f8')
  })

  it('sets a listed font, replacing an uploaded one', () => {
    const withUpload = draft({
      theme: {
        ...loaded().theme,
        customFont: {
          family: 'Brand Sans',
          files: [{ key: 'fonts/a.woff2', weight: 400, style: 'normal' }],
          fallback: 'inter',
        },
      },
    })
    const next = applyDraftPatch(withUpload, { font: 'lora' })
    expect(draftFont(next)).toBe(LORA)
    expect(next.customFont).toBeUndefined()
  })

  it('sets the corner radius', () => {
    expect(draftRadius(applyDraftPatch(draft(), { corners: 0 }))).toBe(0)
  })

  it('never touches Advanced CSS', () => {
    const before = draft()
    const next = applyDraftPatch(before, {
      themeMode: 'dark',
      colours: { light: { main: '#123456' } },
      font: 'roboto',
      corners: 1,
    })
    expect(draftRemainder(next)).toBe(draftRemainder(before))
    expect(draftRemainder(next)).toContain('linear-gradient')
  })

  it('reorders, renames and hides tabs; Feedback stays on', () => {
    const next = applyDraftPatch(draft(), {
      tabs: {
        order: ['changelog', 'roadmap'],
        changes: [
          { id: 'roadmap', label: 'Plans', enabled: false },
          { id: 'feedback', enabled: false },
        ],
      },
    })
    expect(ids(next)).toEqual(['changelog', 'roadmap', 'feedback', 'link-1'])
    expect(next.nav.find((t) => t.id === 'roadmap')).toMatchObject({
      label: 'Plans',
      enabled: false,
    })
    expect(next.nav.find((t) => t.id === 'feedback')?.enabled).not.toBe(false)
  })

  it('writes the welcome message as paragraphs', () => {
    const next = applyDraftPatch(draft(), { welcomeMessage: 'Hello there.\n\nTell us more.' })
    expect(next.welcomeBody).toEqual({
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Hello there.' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Tell us more.' }] },
      ],
    })
  })

  it('merges Help Center home fields, and skips them without the part', () => {
    expect(
      applyDraftPatch(draft(), { helpCenter: { homepageTitle: 'Support' } }).helpCenter
    ).toEqual({ homepageTitle: 'Support', homepageDescription: '', headerLinks: [] })
    const none = draft({ helpCenter: null })
    expect(
      applyDraftPatch(none, { helpCenter: { homepageTitle: 'Support' } }).helpCenter
    ).toBeNull()
  })

  it('does not change the draft it was given', () => {
    const before = draft()
    const snapshot = structuredClone(before)
    applyDraftPatch(before, {
      themeMode: 'dark',
      colours: { light: { main: '#123456', background: '#000000' } },
      tabs: { order: ['roadmap'], changes: [{ id: 'roadmap', label: 'Plans' }] },
      welcomeMessage: 'Hi',
      helpCenter: { homepageTitle: 'X' },
    })
    expect(before).toEqual(snapshot)
  })
})

describe('summariseDraftForAsk', () => {
  it('sends what the prompt needs and never Advanced CSS, logo keys or font files', () => {
    const d = draftFromLoaded(
      loaded({
        theme: {
          themeMode: 'user',
          buttonShape: 'corners',
          light: {
            primary: '#1a73e8',
            background: '#ffffff',
            foreground: '#0a0a0a',
            fontSans: LORA,
            radius: '0.25rem',
          },
          dark: { primary: '#8ab4f8', fontSans: LORA, radius: '0.25rem' },
        },
        helpCenter: null,
        logo: { wideKey: 'header-logos/secret.svg', mode: 'custom_logo' },
        portal: {
          nav: {
            items: [
              { id: 'feedback', type: 'feedback', label: 'Ideas' },
              { id: 'roadmap', type: 'roadmap', enabled: false },
            ],
          },
          welcomeCard: {
            body: {
              type: 'doc',
              content: [
                {
                  type: 'paragraph',
                  content: [
                    { type: 'text', text: 'Hello ' },
                    { type: 'text', text: 'there' },
                  ],
                },
                { type: 'paragraph', content: [{ type: 'text', text: 'Second' }] },
              ],
            },
          },
        } as LoadedPortal['portal'],
      })
    )
    const summary = summariseDraftForAsk(d)
    expect(summary).toMatchObject({
      themeMode: 'user',
      buttonShape: 'corners',
      corners: 0.25,
      font: 'lora',
      colours: { light: { main: '#1a73e8', background: '#ffffff', text: '#0a0a0a' } },
      welcomeMessage: 'Hello there\n\nSecond',
      helpCenter: null,
    })
    expect(summary.colours.dark.main).toBe('#8ab4f8')
    // No header colour set: the summary names none.
    expect(summary.colours.light).not.toHaveProperty('header')
    const withHeader = summariseDraftForAsk(
      applyDraftPatch(d, { colours: { light: { header: '#0b1f3a' } } })
    )
    expect(withHeader.colours.light.header).toBe('#0b1f3a')
    expect(askDraftContextSchema.safeParse(withHeader).success).toBe(true)
    expect(summary.tabs.slice(0, 2)).toEqual([
      { id: 'feedback', type: 'feedback', label: 'Ideas', enabled: true },
      { id: 'roadmap', type: 'roadmap', enabled: false },
    ])
    expect(JSON.stringify(summary)).not.toMatch(/linear-gradient|secret|fonts\//)
  })

  it('names the listed font a saved stack is, even when the stack is not the list’s word for word', () => {
    // How a workspace's Inter is saved: Ask must see Inter, never a gap to fill.
    const inter = (fontSans: string) =>
      summariseDraftForAsk(
        draft({ theme: { themeMode: 'light', light: { fontSans }, dark: { fontSans } } })
      ).font
    expect(inter('"Inter", ui-sans-serif, system-ui, sans-serif')).toBe('inter')
    expect(inter('ui-sans-serif, system-ui, -apple-system, sans-serif')).toBe('system')
    expect(inter('"Brand Sans", ui-sans-serif, system-ui, sans-serif')).toBeNull()
  })

  it('names no listed font while an uploaded one is set', () => {
    const d = draft({
      theme: {
        ...loaded().theme,
        customFont: {
          family: 'Brand Sans',
          files: [{ key: 'fonts/a.woff2', weight: 400, style: 'normal' }],
          fallback: 'inter',
        },
      },
    })
    expect(summariseDraftForAsk(d).font).toBeNull()
  })
})

describe('Ask on headings, cards and the header', () => {
  const withLogo = () =>
    draft({ name: 'Acme', logo: { wideKey: 'header-logos/acme.svg', mode: 'logo_and_name' } })

  it('sets the headings font, and puts headings back in the text font', () => {
    const before = draft()
    const lora = applyDraftPatch(before, { headingFont: 'lora' })
    expect(summariseDraftForAsk(lora).headingFont).toBe('lora')
    expect(summariseDraftForAsk(before).headingFont).toBe('same_as_text')
    const back = applyDraftPatch(lora, { headingFont: 'same_as_text' })
    expect(summariseDraftForAsk(back).headingFont).toBe('same_as_text')
    expect(draftRemainder(back)).toBe(draftRemainder(before))
  })

  it('sees no listed headings font while an uploaded one is set', () => {
    const d = {
      ...draft(),
      customHeadingFont: {
        family: 'Brand Display',
        files: [{ key: 'fonts/d.woff2', weight: 700, style: 'normal' as const }],
        fallback: 'inter' as const,
      },
    }
    expect(summariseDraftForAsk(d).headingFont).toBeNull()
  })

  it('sets the card style', () => {
    const next = applyDraftPatch(draft(), { cardStyle: 'shadow' })
    expect(next.cardStyle).toBe('shadow')
    expect(summariseDraftForAsk(next).cardStyle).toBe('shadow')
  })

  it('names the portal; empty or the workspace name puts the workspace name back', () => {
    const named = applyDraftPatch(withLogo(), { portalName: '  Acme Ideas ' })
    expect(named.headerName).toBe('Acme Ideas')
    expect(summariseDraftForAsk(named)).toMatchObject({
      portalName: 'Acme Ideas',
      workspaceName: 'Acme',
    })
    expect(applyDraftPatch(named, { portalName: '' }).headerName).toBe('')
    expect(applyDraftPatch(named, { portalName: 'Acme' }).headerName).toBe('')
  })

  it('shows the logo only when the draft has one', () => {
    const d = withLogo()
    expect(summariseDraftForAsk(d)).toMatchObject({ headerShows: 'icon_and_name', hasLogo: true })
    const logo = applyDraftPatch(d, { headerShows: 'logo' })
    expect(logo.logo.mode).toBe('custom_logo')
    expect(summariseDraftForAsk(logo).headerShows).toBe('logo')
    expect(applyDraftPatch(logo, { headerShows: 'icon_and_name' }).logo.mode).toBe('logo_and_name')
    // No logo uploaded: nothing to show, so nothing changes.
    const none = draft()
    expect(summariseDraftForAsk(none).hasLogo).toBe(false)
    expect(applyDraftPatch(none, { headerShows: 'logo' })).toBe(none)
  })

  it('puts the background and text back on Auto', () => {
    const before = applyDraftPatch(draft(), {
      colours: { light: { background: '#f8f6f1', text: '#334155' } },
    })
    const auto = applyDraftPatch(before, {
      colours: { light: { background: 'auto', text: 'auto' } },
    })
    expect(summariseDraftForAsk(auto).colours.light).toMatchObject({
      background: '#ffffff',
      text: '#0a0a0a',
    })
    expect(askDraftContextSchema.safeParse(summariseDraftForAsk(auto)).success).toBe(true)
  })
})
