/**
 * What one change did to the draft, in plain words: the chat's reply and the
 * preview's outlines both come from this one comparison of the draft before
 * and after, never from model text.
 */
import { describe, expect, it } from 'vitest'
import {
  draftFromLoaded,
  editLogo,
  editHeaderName,
  editTheme,
  type LoadedPortal,
  type PortalDraft,
} from '../portal-draft'
import { applyDraftPatch } from '../ask-draft'
import { flashTargets, summariseChange } from '../change-summary'

function loaded(overrides: Partial<LoadedPortal> = {}): LoadedPortal {
  return {
    theme: {
      themeMode: 'light',
      light: { primary: '#15803d', background: '#ffffff', foreground: '#0a0a0a', radius: '0.5rem' },
      dark: { primary: '#15803d', background: '#0a0a0a', foreground: '#fafafa', radius: '0.5rem' },
    },
    customCss: '',
    portal: {
      nav: {
        items: [
          { id: 'feedback', type: 'feedback' },
          { id: 'roadmap', type: 'roadmap' },
          { id: 'changelog', type: 'changelog' },
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
const userTheme = { ...loaded().theme, themeMode: 'user' as const }
const texts = (before: PortalDraft, after: PortalDraft) =>
  summariseChange(before, after).lines.map((line) => line.text)

describe('summariseChange: what changed', () => {
  it('says nothing for a draft that did not change', () => {
    const d = draft()
    expect(summariseChange(d, d)).toEqual({ lines: [], adjustments: [] })
    expect(summariseChange(d, applyDraftPatch(d, {}))).toEqual({ lines: [], adjustments: [] })
  })

  it('names a header colour with a swatch, and square corners and buttons in one line', () => {
    const before = draft()
    const after = applyDraftPatch(before, {
      colours: { light: { header: '#0b1f3a' } },
      buttonShape: 'corners',
      corners: 0,
    })
    const { lines } = summariseChange(before, after)
    expect(lines).toEqual([
      { text: 'Header is now navy', swatch: '#0b1f3a', target: 'header', section: 'colours' },
      {
        text: 'Corners and buttons are now square',
        swatchShape: 'square',
        target: 'colours',
        // The line opens the section that makes it, which is not the part it flashes.
        section: 'font',
      },
    ])
  })

  it('names the main colour, background and text', () => {
    const before = draft()
    const after = applyDraftPatch(before, {
      colours: { light: { main: '#ea580c', background: '#f8f6f1', text: '#0b1f3a' } },
    })
    expect(summariseChange(before, after).lines).toEqual([
      {
        text: 'Main colour is now orange',
        swatch: '#ea580c',
        target: 'colours',
        section: 'colours',
      },
      { text: 'Background is now off-white', swatch: '#f8f6f1', section: 'colours' },
      { text: 'Text is now navy', swatch: '#0b1f3a', section: 'colours' },
    ])
  })

  it('leaves out a side the portal does not show', () => {
    const before = draft()
    const after = applyDraftPatch(before, { colours: { dark: { background: '#111317' } } })
    expect(texts(before, after)).toEqual([])
  })

  it('says one line when light and dark take the same colour, and names the side when one does', () => {
    const before = draft({ theme: userTheme })
    const both = applyDraftPatch(before, {
      colours: { light: { header: '#0b1f3a' }, dark: { header: '#0b1f3a' } },
    })
    expect(texts(before, both)).toEqual(['Header is now navy'])
    const one = applyDraftPatch(before, { colours: { dark: { header: '#0b1f3a' } } })
    expect(texts(before, one)).toEqual(['Header is now navy in dark mode'])
    const differ = applyDraftPatch(before, {
      colours: { light: { background: '#f8f6f1' }, dark: { background: '#0b1220' } },
    })
    expect(texts(before, differ)).toEqual([
      'Background is now off-white in light mode',
      'Background is now navy in dark mode',
      // The dark side's text was automatic and stays readable on its own.
    ])
  })

  it('says the header matches the page again when it goes back to Auto', () => {
    const navy = applyDraftPatch(draft(), { colours: { light: { header: '#0b1f3a' } } })
    const auto = applyDraftPatch(navy, { colours: { light: { header: 'auto' } } })
    expect(summariseChange(navy, auto)).toEqual({
      lines: [{ text: 'Header matches the page again', target: 'header', section: 'colours' }],
      adjustments: [],
    })
  })

  it('names the font, the corners, the button shape and the theme mode', () => {
    const before = draft()
    expect(texts(before, applyDraftPatch(before, { font: 'lora' }))).toEqual(['Font is now Lora'])
    expect(texts(before, applyDraftPatch(before, { corners: 1 }))).toEqual([
      'Corners are now round',
    ])
    const matched = applyDraftPatch(before, { buttonShape: 'corners' })
    expect(texts(before, matched)).toEqual(['Buttons have softly rounded corners'])
    expect(texts(matched, applyDraftPatch(matched, { buttonShape: 'pill' }))).toEqual([
      'Buttons are now pill shaped',
    ])
    expect(texts(before, applyDraftPatch(before, { themeMode: 'user' }))).toEqual([
      'Visitors can now choose light or dark',
    ])
    expect(texts(before, applyDraftPatch(before, { themeMode: 'dark' }))).toEqual([
      'The portal is now dark only',
    ])
  })

  it('names tab changes: first, renamed, hidden and shown', () => {
    const before = draft()
    const first = applyDraftPatch(before, { tabs: { order: ['roadmap'] } })
    expect(summariseChange(before, first).lines).toEqual([
      { text: 'Roadmap is now first', target: 'nav', section: 'header' },
    ])
    const changed = applyDraftPatch(before, {
      tabs: {
        changes: [
          { id: 'roadmap', label: 'Plans' },
          { id: 'changelog', enabled: false },
        ],
      },
    })
    expect(texts(before, changed)).toEqual([
      'Roadmap is now called Plans',
      'Changelog is now hidden',
    ])
    expect(
      texts(
        changed,
        applyDraftPatch(changed, { tabs: { changes: [{ id: 'changelog', enabled: true }] } })
      )
    ).toEqual(['Changelog is now shown'])
    const last = applyDraftPatch(before, { tabs: { order: ['roadmap', 'changelog', 'feedback'] } })
    expect(texts(before, last)[0]).toBe('Roadmap is now first')
    // Every tab the draft has, Roadmap moved to the end.
    const rest = before.nav.map((tab) => tab.id).filter((id) => id !== 'roadmap')
    const shuffled = applyDraftPatch(before, { tabs: { order: [...rest, 'roadmap'] } })
    expect(texts(before, shuffled)).toEqual(['Roadmap is now last'])
  })

  it('names the welcome message and the Help Center title and description', () => {
    const before = draft()
    const after = applyDraftPatch(before, {
      welcomeMessage: 'Hi there!',
      helpCenter: { homepageTitle: 'Answers', homepageDescription: 'Guides for everything' },
    })
    expect(summariseChange(before, after).lines).toEqual([
      { text: 'Welcome message updated', target: 'welcome', section: 'welcome' },
      { text: 'Help Center title is now “Answers”', target: 'hc-home', section: 'hc-home' },
      { text: 'Help Center description updated', target: 'hc-home', section: 'hc-home' },
    ])
    expect(texts(after, applyDraftPatch(after, { welcomeMessage: '' }))).toEqual([
      'Welcome message is now hidden',
    ])
  })

  it('names a new logo', () => {
    const before = draft()
    const after = editLogo.setUploadedWide(before, 'header-logos/new.svg')
    expect(summariseChange(before, after).lines).toEqual([
      { text: 'Logo updated', target: 'logo', section: 'header' },
    ])
  })
})

describe('summariseChange: what the editor adjusted', () => {
  it('says the header text turned white, and the button with it, to read on navy', () => {
    const before = editTheme.setColour(draft(), 'primary', 'light', '#1e3a8a')
    const after = applyDraftPatch(before, { colours: { light: { header: '#0b1f3a' } } })
    // Dark blue on navy is under 3:1, so the main button is turned over as well.
    expect(summariseChange(before, after).adjustments).toEqual([
      "The header's text and tabs are now white so they read on navy.",
      "The header's button is now white too, so it stands out.",
    ])
  })

  it('says each adjustment once when both sides made it, the text on one side only', () => {
    // Visitors choose: the header goes navy on both sides. The light side's
    // text turns white; the dark side's was white already. Both buttons turn over.
    let before = draft({ theme: userTheme })
    for (const side of ['light', 'dark'] as const)
      before = editTheme.setColour(before, 'primary', side, '#1e3a8a')
    const after = applyDraftPatch(before, {
      colours: { light: { header: '#0b1f3a' }, dark: { header: '#0b1f3a' } },
    })
    expect(summariseChange(before, after).adjustments).toEqual([
      "The header's text and tabs are now white so they read on navy.",
      "The header's button is now white too, so it stands out.",
    ])
  })

  it('leaves the button alone when it shows on the bar', () => {
    const before = draft()
    const after = applyDraftPatch(before, { colours: { light: { header: '#0b1f3a' } } })
    expect(summariseChange(before, after).adjustments).toEqual([
      "The header's text and tabs are now white so they read on navy.",
    ])
  })

  it('says the text turned dark on a light bar over a dark page', () => {
    const before = draft({ theme: { ...loaded().theme, themeMode: 'dark' } })
    const after = applyDraftPatch(before, { colours: { dark: { header: '#fef3c7' } } })
    expect(summariseChange(before, after).adjustments[0]).toBe(
      "The header's text and tabs are now dark so they read on light yellow."
    )
  })

  it('says nothing when the page text already reads on the bar', () => {
    const before = draft()
    const after = applyDraftPatch(before, { colours: { light: { header: '#f8f6f1' } } })
    expect(summariseChange(before, after).adjustments).toEqual([])
  })

  it('does not call a button turned over just because its own text is the bar colour', () => {
    // A near-black main colour has white text of its own; on a white bar it shows as it is.
    const before = editTheme.setColour(draft(), 'primary', 'light', '#171717')
    const after = applyDraftPatch(before, { colours: { light: { header: '#ffffff' } } })
    expect(summariseChange(before, after).lines.map((l) => l.text)).toEqual(['Header is now white'])
    expect(summariseChange(before, after).adjustments).toEqual([])
  })

  it('says nothing about a header that did not change', () => {
    const navy = applyDraftPatch(draft(), { colours: { light: { header: '#0b1f3a' } } })
    expect(summariseChange(navy, applyDraftPatch(navy, { font: 'lora' })).adjustments).toEqual([])
  })

  it('says the button was turned over when a new main colour vanishes into the bar', () => {
    const before = editTheme.setColour(
      editTheme.setColour(draft(), 'primary', 'light', '#facc15'),
      'header',
      'light',
      '#0b1f3a'
    )
    const after = applyDraftPatch(before, { colours: { light: { main: '#1e3a8a' } } })
    expect(summariseChange(before, after).adjustments).toEqual([
      "The header's button is now white so it stands out.",
    ])
  })
})

describe('flashTargets', () => {
  it('outlines each changed area once', () => {
    const before = draft()
    const after = applyDraftPatch(before, {
      colours: { light: { header: '#0b1f3a' } },
      buttonShape: 'corners',
      corners: 0,
    })
    expect(flashTargets(summariseChange(before, after))).toEqual(['header', 'colours'])
  })

  it('outlines nothing for broad changes: a font, the theme mode, the background', () => {
    const before = draft()
    const after = applyDraftPatch(before, {
      font: 'lora',
      themeMode: 'user',
      colours: { light: { background: '#f8f6f1' } },
    })
    expect(summariseChange(before, after).lines).toHaveLength(3)
    expect(flashTargets(summariseChange(before, after))).toEqual([])
  })

  it('outlines three areas, and none at all when more would show', () => {
    const before = draft()
    const three = applyDraftPatch(before, {
      colours: { light: { header: '#0b1f3a', main: '#ea580c' } },
      tabs: { order: ['roadmap'] },
    })
    expect(flashTargets(summariseChange(before, three))).toEqual(['colours', 'header', 'nav'])
    const four = applyDraftPatch(three, { welcomeMessage: 'Hi there!' })
    expect(flashTargets(summariseChange(before, four))).toEqual([])
  })
})

describe('summariseChange: headings, cards and the name', () => {
  const lines = (before: PortalDraft, after: PortalDraft) => summariseChange(before, after).lines

  it('names a new headings font, and says when headings match the text again', () => {
    const before = draft()
    const manrope = editTheme.setHeadingFont(
      before,
      '"Manrope", ui-sans-serif, system-ui, sans-serif'
    )
    expect(lines(before, manrope)).toEqual([
      { text: 'Headings are now set in Manrope', section: 'font' },
    ])
    expect(lines(manrope, editTheme.setHeadingFont(manrope, null))).toEqual([
      { text: 'Headings match the text font again', section: 'font' },
    ])
    const uploaded = editTheme.setUploadedHeadingFont(before, {
      family: 'Northwind Display',
      fallback: 'inter',
      files: [{ key: 'fonts/h.woff2', weight: 600, style: 'normal' }],
    })
    expect(texts(before, uploaded)).toEqual(['Headings are now set in Northwind Display'])
    // The text font's own line stays its own.
    expect(texts(before, editTheme.setFont(before, '"Lora", ui-serif, Georgia, serif'))).toEqual([
      'Font is now Lora',
    ])
  })

  it('says how cards now stand off the page, pointing at a card', () => {
    const before = draft()
    expect(lines(before, editTheme.setCardStyle(before, 'shadow'))).toEqual([
      { text: 'Cards now have a shadow', target: 'type', section: 'font' },
    ])
    expect(texts(before, editTheme.setCardStyle(before, 'flat'))).toEqual(['Cards are now flat'])
    const flat = editTheme.setCardStyle(before, 'flat')
    expect(texts(flat, editTheme.setCardStyle(flat, 'border'))).toEqual([
      'Cards have a border again',
    ])
  })

  it('names the new portal name, pointing at the logo', () => {
    const before = draft({ name: 'Acme Corp' })
    const after = editHeaderName(before, 'Northwind')
    expect(lines(before, after)).toEqual([
      { text: 'Portal name is now Northwind', target: 'logo', section: 'header' },
    ])
    // Cleared, the header shows the workspace's name again.
    expect(lines(after, editHeaderName(after, ''))).toEqual([
      { text: 'Portal name is now Acme Corp', target: 'logo', section: 'header' },
    ])
    expect(flashTargets(summariseChange(before, after))).toEqual(['logo'])
  })
})

describe('summariseChange: what Ask sets beyond colours and shape', () => {
  const withLogo = () =>
    draft({ name: 'Acme Corp', logo: { wideKey: 'header-logos/acme.svg', mode: 'logo_and_name' } })

  it('says what the header shows, as its tiles name it', () => {
    const before = withLogo()
    const after = applyDraftPatch(before, { headerShows: 'logo' })
    expect(summariseChange(before, after).lines).toEqual([
      { text: 'Header now shows the logo', target: 'logo', section: 'header' },
    ])
    expect(texts(after, applyDraftPatch(after, { headerShows: 'icon_and_name' }))).toEqual([
      'Header now shows the icon and name',
    ])
  })

  it('reads each new patch field back in one plain line', () => {
    const before = withLogo()
    expect(texts(before, applyDraftPatch(before, { headingFont: 'lora' }))).toEqual([
      'Headings are now set in Lora',
    ])
    expect(texts(before, applyDraftPatch(before, { cardStyle: 'flat' }))).toEqual([
      'Cards are now flat',
    ])
    expect(texts(before, applyDraftPatch(before, { portalName: 'Acme Ideas' }))).toEqual([
      'Portal name is now Acme Ideas',
    ])
    const back = applyDraftPatch(before, { colours: { light: { text: '#334155' } } })
    expect(texts(back, applyDraftPatch(back, { colours: { light: { text: 'auto' } } }))).toEqual([
      'Text is now black',
    ])
  })
})
