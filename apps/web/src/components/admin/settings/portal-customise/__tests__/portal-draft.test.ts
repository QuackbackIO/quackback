/**
 * The Customise draft: one value for everything on the page, an in-session
 * history of it, what changed against what is live, and the one publish that
 * sends only the changed parts with what the editor loaded for each.
 */
import { describe, expect, it } from 'vitest'
import { advancedCssRemainder } from '@/lib/shared/theme/readable-css'
import { extractCssVariables } from '@/lib/shared/theme/css-parser'
import { publishPortalCustomisationSchema } from '@/lib/shared/schemas/portal-customise'
import {
  applyToHistory,
  darkSurfaceOf,
  draftChanges,
  draftFont,
  draftFontName,
  draftFromLoaded,
  draftHeadingFont,
  draftHeadingName,
  editHeaderName,
  shownName,
  draftPalette,
  editLogo,
  editTheme,
  themeChanged,
  wideLogoUrl,
  publishedFromLoaded,
  publishInput,
  iconUrl,
  redoHistory,
  startHistory,
  undoHistory,
  type LoadedPortal,
  type PortalDraft,
} from '../portal-draft'

const loaded: LoadedPortal = {
  theme: { themeMode: 'user' },
  customCss: '',
  portal: {
    nav: { items: [{ id: 'feedback', type: 'feedback' }] },
    welcomeCard: { body: { type: 'doc', content: [] } },
  } as unknown as LoadedPortal['portal'],
  helpCenter: {
    homepageTitle: 'How can we help?',
    homepageDescription: 'Search our knowledge base or browse by category',
    headerLinks: [],
  } as unknown as LoadedPortal['helpCenter'],
}

const base = draftFromLoaded(loaded)

describe('the draft', () => {
  it('holds every part of the page, the tabs seeded with the built-in ones', () => {
    expect(base.themeMode).toBe('user')
    expect(base.buttonShape).toBe('pill')
    expect(base.nav.map((i) => i.type)).toContain('roadmap')
    expect(base.helpCenter?.homepageTitle).toBe('How can we help?')
  })

  it('has no Help Center part for someone who cannot manage it', () => {
    expect(draftFromLoaded({ ...loaded, helpCenter: null }).helpCenter).toBeNull()
  })

  it('a colour write regenerates the stylesheet: no remainder, no stale derived lines', () => {
    const next = editTheme.setColour(base, 'background', 'light', '#f8f6f1')
    expect(advancedCssRemainder(next.cssText)).toBe('')
    expect(draftPalette(next, 'light').background).toBe('#f8f6f1')
    expect(draftPalette(next, 'light').card).not.toBe(draftPalette(base, 'light').card)
  })

  it('sets a colour back to auto', () => {
    const tinted = editTheme.setColour(base, 'background', 'light', '#0b1220')
    const auto = editTheme.setColour(tinted, 'background', 'light', null)
    expect(draftPalette(auto, 'light')).toEqual(draftPalette(base, 'light'))
  })

  it('sets a header colour on one side, and puts it back on Auto', () => {
    const blue = editTheme.setColour(base, 'header', 'light', '#005eb8')
    expect(advancedCssRemainder(blue.cssText)).toBe('')
    expect(draftPalette(blue, 'light').header).toBe('#005eb8')
    expect(draftPalette(blue, 'dark').header).toBeUndefined()
    const auto = editTheme.setColour(blue, 'header', 'light', null)
    expect(draftPalette(auto, 'light')).toEqual(draftPalette(base, 'light'))
    expect(auto.cssText).not.toContain('--header')
  })

  it('keeps the header colour through another colour’s write', () => {
    const blue = editTheme.setColour(base, 'header', 'light', '#005eb8')
    const next = editTheme.setColour(blue, 'primary', 'light', '#e11d48')
    expect(draftPalette(next, 'light')).toMatchObject({ header: '#005eb8', primary: '#e11d48' })
    expect(draftPalette(next, 'dark').header).toBeUndefined()
  })

  it('keeps the Advanced CSS rules through a colour write', () => {
    const own = editTheme.setCssText(base, `${base.cssText}\n\n.portal-header { color: red; }`)
    const next = editTheme.setColour(own, 'primary', 'light', '#533afd')
    expect(next.cssText).toContain('.portal-header { color: red; }')
    expect(extractCssVariables(next.cssText).light['--primary']).toBe('#533afd')
  })
})

describe('history', () => {
  const edit = (draft: PortalDraft, title: string): PortalDraft => ({
    ...draft,
    helpCenter: { ...draft.helpCenter!, homepageTitle: title },
  })

  it('undoes and redoes each step', () => {
    let h = startHistory(base)
    h = applyToHistory(h, edit(h.present, 'A'), { now: 0 })
    h = applyToHistory(h, edit(h.present, 'B'), { now: 5000 })
    h = undoHistory(h)
    expect(h.present.helpCenter?.homepageTitle).toBe('A')
    h = undoHistory(h)
    expect(h.present).toBe(base)
    h = redoHistory(redoHistory(h))
    expect(h.present.helpCenter?.homepageTitle).toBe('B')
  })

  it('takes a typing burst or a drag as one step', () => {
    let h = startHistory(base)
    for (const [i, title] of ['H', 'He', 'Hel'].entries()) {
      h = applyToHistory(h, edit(h.present, title), { burst: 'hc-title', now: i * 200 })
    }
    expect(h.past).toHaveLength(1)
    h = undoHistory(h)
    expect(h.present).toBe(base)
  })

  it('starts a new step after a pause or on another control', () => {
    let h = startHistory(base)
    h = applyToHistory(h, edit(h.present, 'A'), { burst: 'hc-title', now: 0 })
    h = applyToHistory(h, edit(h.present, 'AB'), { burst: 'hc-title', now: 3000 })
    h = applyToHistory(h, edit(h.present, 'ABC'), { burst: 'other', now: 3100 })
    expect(h.past).toHaveLength(3)
  })

  it('keeps the last 100 steps', () => {
    let h = startHistory(base)
    for (let i = 0; i < 120; i++) h = applyToHistory(h, edit(h.present, `${i}`), { now: i * 5000 })
    expect(h.past).toHaveLength(100)
  })

  it('a new edit after an undo drops the redo steps', () => {
    let h = startHistory(base)
    h = applyToHistory(h, edit(h.present, 'A'), { now: 0 })
    h = undoHistory(h)
    h = applyToHistory(h, edit(h.present, 'B'), { now: 5000 })
    expect(h.future).toHaveLength(0)
  })
})

describe('draftChanges', () => {
  it('is empty for the loaded draft', () => {
    expect(draftChanges(base, base)).toEqual([])
  })

  it('names each changed setting once', () => {
    let draft = editTheme.setColour(base, 'primary', 'light', '#533afd')
    draft = editTheme.setColour(draft, 'background', 'light', '#f8f6f1')
    draft = editTheme.setRadius(draft, 0.25)
    draft = { ...draft, buttonShape: 'corners', themeMode: 'light' }
    draft = { ...draft, nav: draft.nav.slice().reverse() }
    expect(draftChanges(base, draft)).toEqual([
      'Light and dark',
      'Colours',
      'Corners',
      'Buttons',
      'Tabs',
    ])
  })
})

describe('publishInput', () => {
  const published = publishedFromLoaded(loaded)

  describe('the brand assets confirmation', () => {
    const files = [
      { key: 'fonts/2026/11/r-staged-import.woff2', weight: 400, style: 'normal' as const },
    ]
    const brand = {
      host: 'northwind.com',
      logo: { kind: 'wide' as const, stagedKey: 'header-logos/n.svg', url: '/n.svg' },
      icon: { key: 'logos/n.png', faviconKey: 'favicons/n.png', url: '/n.png' },
      siteFont: { family: 'Calibre', licence: 'commercial' as const, files },
    }
    const imported: PortalDraft = {
      ...base,
      logo: {
        wideKey: 'header-logos/n.svg',
        mode: 'custom_logo',
        icon: { key: 'logos/n.png', faviconKey: 'favicons/n.png' },
      },
      customFont: { family: 'Calibre', fallback: 'inter', files },
    }

    it('travels with a publish of the imported logo, icon and font', () => {
      const input = publishInput(base, imported, published, {
        brandAssets: { brand, preTicked: ['logo', 'icon', 'font'] },
      })!
      expect(input.brandAssets).toEqual({
        host: 'northwind.com',
        assets: ['logo', 'icon', 'font'],
        preTicked: ['logo', 'icon', 'font'],
      })
      expect(() => publishPortalCustomisationSchema.parse(input)).not.toThrow()
    })

    it('marks as pre-ticked only the assets nobody clicked, among those it carries', () => {
      // On the site's own domain all started in use; the person turned the icon off and on again.
      const { customFont: _font, ...noFont } = imported
      const input = publishInput(base, noFont, published, {
        brandAssets: { brand, preTicked: ['logo', 'font'] },
      })!
      expect(input.brandAssets).toEqual({
        host: 'northwind.com',
        assets: ['logo', 'icon'],
        preTicked: ['logo'],
      })
    })

    it('names the imported website on any publish after an import, and none without one', () => {
      const recoloured = { ...base, themeMode: 'dark' as const }
      const withImport = publishInput(base, recoloured, published, {
        brandAssets: { brand, preTicked: [] },
      })!
      expect(withImport.importedFrom).toBe('northwind.com')
      expect(withImport.brandAssets).toBeUndefined()
      expect(() => publishPortalCustomisationSchema.parse(withImport)).not.toThrow()
      expect(publishInput(base, recoloured, published)!.importedFrom).toBeUndefined()
    })

    it('names only the assets still the imported ones', () => {
      const mine = { ...imported, logo: { ...imported.logo, wideKey: 'header-logos/mine.svg' } }
      const { customFont: _font, ...noFont } = mine
      expect(
        publishInput(base, noFont, published, { brandAssets: { brand, preTicked: [] } })!
          .brandAssets
      ).toEqual({ host: 'northwind.com', assets: ['icon'], preTicked: [] })
    })

    it('leaves an open-licence font out: it needed no confirmation', () => {
      const open = { ...brand, siteFont: { ...brand.siteFont, licence: 'open' as const } }
      expect(
        publishInput(base, imported, published, { brandAssets: { brand: open, preTicked: [] } })!
          .brandAssets?.assets
      ).toEqual(['logo', 'icon'])
    })

    it('is absent when nothing imported is published, when unticked, or already live', () => {
      const dark = { ...base, themeMode: 'dark' as const }
      expect(
        publishInput(base, dark, published, { brandAssets: { brand, preTicked: [] } })!.brandAssets
      ).toBeUndefined()
      expect(publishInput(base, imported, published)!.brandAssets).toBeUndefined()
      // Published once already: a later publish of something else does not confirm again.
      expect(
        publishInput(imported, { ...imported, themeMode: 'dark' }, published, {
          brandAssets: { brand, preTicked: [] },
        })!.brandAssets
      ).toBeUndefined()
    })

    it('counts a commercial headings font copied from the site as the headings font, its own asset', () => {
      const headingFiles = [
        { key: 'fonts/2026/11/h-staged-import.woff2', weight: 600, style: 'normal' as const },
      ]
      const { siteFont: _text, ...rest } = brand
      const withHeading = {
        ...rest,
        siteHeadingFont: {
          family: 'Calibre Display',
          licence: 'commercial' as const,
          files: headingFiles,
        },
      }
      const draft: PortalDraft = {
        ...base,
        customHeadingFont: { family: 'Calibre Display', fallback: 'inter', files: headingFiles },
      }
      const confirm = { brandAssets: { brand: withHeading, preTicked: [] } }
      expect(publishInput(base, draft, published, confirm)!.brandAssets?.assets).toEqual([
        'headingFont',
      ])
      // Already live, or an open-licence one, it confirms nothing.
      expect(
        publishInput(draft, { ...draft, themeMode: 'dark' }, published, confirm)!.brandAssets
      ).toBeUndefined()
      const open = {
        ...withHeading,
        siteHeadingFont: { ...withHeading.siteHeadingFont, licence: 'open' as const },
      }
      expect(
        publishInput(base, draft, published, { brandAssets: { brand: open, preTicked: [] } })!
          .brandAssets
      ).toBeUndefined()
    })

    it('is left out for a host the record cannot hold, rather than failing the publish', () => {
      const input = publishInput(base, imported, published, {
        brandAssets: { brand: { ...brand, host: 'Not A Host' }, preTicked: [] },
      })!
      expect(input.brandAssets).toBeUndefined()
      expect(() => publishPortalCustomisationSchema.parse(input)).not.toThrow()
    })
  })

  it('is null when nothing changed', () => {
    expect(publishInput(base, base, published)).toBeNull()
  })

  it('sends only the changed parts, each with what the editor loaded', () => {
    const draft = { ...base, helpCenter: { ...base.helpCenter!, homepageTitle: 'Hi' } }
    const input = publishInput(base, draft, published)!
    expect(input).toEqual({
      before: { helpCenter: { homepageTitle: 'How can we help?' } },
      helpCenter: { homepageTitle: 'Hi' },
    })
    expect(() => publishPortalCustomisationSchema.parse(input)).not.toThrow()
  })

  it('sends the theme with the button shape and its Advanced CSS', () => {
    const draft = { ...base, buttonShape: 'corners' as const }
    const input = publishInput(base, draft, published)!
    expect(input.before).toEqual({ theme: { themeMode: 'user' }, customCss: '' })
    expect(input.theme?.buttonShape).toBe('corners')
    expect(input.customCss).toBe('')
    expect(() => publishPortalCustomisationSchema.parse(input)).not.toThrow()
  })

  it('leaves the Advanced CSS out when it is parked', () => {
    const own = editTheme.setCssText(base, `${base.cssText}\n\n.x { color: red; }`)
    const input = publishInput(base, own, published, { parkCss: true })!
    expect(input.customCss).toBeUndefined()
    expect(input.before).toEqual({ theme: { themeMode: 'user' } })
  })

  it('drops tab rows that have no address yet', () => {
    const draft = { ...base, nav: [...base.nav, { id: 'l1', type: 'link' as const, url: '' }] }
    const input = publishInput(base, draft, published)!
    expect(input.portal?.nav?.items?.some((i) => i.type === 'link')).toBe(false)
  })
})

describe('the logo part', () => {
  const WIDE = 'header-logos/2026/11/abc-wordmark.svg'
  const withWide = draftFromLoaded({ ...loaded, logo: { wideKey: WIDE, mode: 'custom_logo' } })
  const published = publishedFromLoaded(loaded)

  it('starts from what is live, a square icon by default', () => {
    expect(base.logo).toEqual({ wideKey: null, mode: 'logo_and_name', icon: null })
    expect(withWide.logo).toEqual({ wideKey: WIDE, mode: 'custom_logo', icon: null })
    expect(published.logo).toEqual({
      wideKey: null,
      darkKey: null,
      headerDisplayMode: 'logo_and_name',
      icon: null,
    })
  })

  it('shows an uploaded wide logo at once, from this origin', () => {
    const next = editLogo.setUploadedWide(base, WIDE)
    expect(next.logo).toEqual({ wideKey: WIDE, mode: 'custom_logo', icon: null })
    expect(wideLogoUrl(WIDE)).toBe(`/api/storage/${WIDE}`)
    expect(draftChanges(base, next)).toEqual(['Logo'])
  })

  it('switches between the square icon and a wide logo it holds', () => {
    const square = editLogo.showSquare(withWide)
    expect(square.logo).toMatchObject({ wideKey: WIDE, mode: 'logo_and_name' })
    expect(editLogo.showWide(square).logo).toMatchObject({ wideKey: WIDE, mode: 'custom_logo' })
    // Nothing to switch to without a wide logo.
    expect(editLogo.showWide(base)).toBe(base)
  })

  it('removes the wide logo and goes back to the square icon', () => {
    expect(editLogo.removeWide(withWide).logo).toMatchObject({
      wideKey: null,
      mode: 'logo_and_name',
    })
  })

  it('publishes a new wide logo with custom_logo, each with what was loaded as before', () => {
    const input = publishInput(base, editLogo.setUploadedWide(base, WIDE), published)!
    expect(input).toEqual({
      before: { logo: { wideKey: null, headerDisplayMode: 'logo_and_name' } },
      logo: { wideKey: WIDE, headerDisplayMode: 'custom_logo' },
    })
    expect(() => publishPortalCustomisationSchema.parse(input)).not.toThrow()
  })

  it('sends only the display mode when the wide logo stays', () => {
    const live = publishedFromLoaded({ ...loaded, logo: { wideKey: WIDE, mode: 'custom_logo' } })
    const input = publishInput(withWide, editLogo.showSquare(withWide), live)!
    expect(input).toEqual({
      before: { logo: { headerDisplayMode: 'custom_logo' } },
      logo: { headerDisplayMode: 'logo_and_name' },
    })
  })

  it('a removed wide logo publishes as no key and the square icon', () => {
    const live = publishedFromLoaded({ ...loaded, logo: { wideKey: WIDE, mode: 'custom_logo' } })
    const input = publishInput(withWide, editLogo.removeWide(withWide), live)!
    expect(input.logo).toEqual({ wideKey: null, headerDisplayMode: 'logo_and_name' })
    expect(input.before.logo).toEqual({ wideKey: WIDE, headerDisplayMode: 'custom_logo' })
  })

  describe('the icon', () => {
    const live = { key: 'logos/live.png', faviconKey: 'favicons/live.png' }
    const fresh = { key: 'logos/2026/11/new.png', faviconKey: 'favicons/2026/11/new.png' }
    const withIcon = draftFromLoaded({
      ...loaded,
      logo: { wideKey: null, mode: 'logo_and_name', icon: live },
    })
    const livePublished = publishedFromLoaded({
      ...loaded,
      logo: { wideKey: null, mode: 'logo_and_name', icon: live },
    })

    it('starts from the live icon, and shows a new one from this origin', () => {
      expect(withIcon.logo.icon).toEqual(live)
      const next = editLogo.setUploadedIcon(withIcon, fresh)
      expect(next.logo.icon).toEqual(fresh)
      expect(iconUrl(fresh.key)).toBe(`/api/storage/${fresh.key}`)
      expect(draftChanges(withIcon, next)).toEqual(['Icon'])
    })

    it('publishes a new icon with its favicon, with the live pair as before', () => {
      const input = publishInput(
        withIcon,
        editLogo.setUploadedIcon(withIcon, fresh),
        livePublished
      )!
      expect(input).toEqual({ before: { logo: { icon: live } }, logo: { icon: fresh } })
      expect(() => publishPortalCustomisationSchema.parse(input)).not.toThrow()
    })

    it('a new icon taken back before publishing changes nothing', () => {
      const back = editLogo.setUploadedIcon(editLogo.setUploadedIcon(withIcon, fresh), live)
      expect(publishInput(withIcon, back, livePublished)).toBeNull()
    })
  })

  it('an upload taken back before publishing changes nothing', () => {
    const back = editLogo.removeWide(editLogo.setUploadedWide(base, WIDE))
    expect(draftChanges(base, back)).toEqual([])
    expect(publishInput(base, back, published)).toBeNull()
  })
})

describe('an uploaded font', () => {
  const brand = {
    family: 'Brand Sans',
    fallback: 'lora' as const,
    files: [
      { key: 'fonts/2026/11/a-brand-regular.woff2', weight: 400, style: 'normal' as const },
      { key: 'fonts/2026/11/b-brand-bold.woff2', weight: 700, style: 'normal' as const },
    ],
  }
  const lora = '"Lora", ui-serif, Georgia, serif'
  const withFont = draftFromLoaded({
    ...loaded,
    theme: {
      themeMode: 'user',
      customFont: brand,
      light: { fontSans: lora },
      dark: { fontSans: lora },
    },
  })
  const published = publishedFromLoaded(loaded)

  it('is part of the draft, with its fallback as the stylesheet font', () => {
    expect(base.customFont).toBeUndefined()
    expect(withFont.customFont).toEqual(brand)
    expect(draftFont(withFont)).toBe(lora)
  })

  it('a publish of any theme change keeps the stored font', () => {
    const input = publishInput(withFont, { ...withFont, buttonShape: 'corners' }, published)!
    expect(input.theme?.customFont).toEqual(brand)
    expect(() => publishPortalCustomisationSchema.parse(input)).not.toThrow()
  })

  it('uploading one sets the family and its fallback, and publishes both', () => {
    const next = editTheme.setUploadedFont(base, brand, lora)
    expect(next.customFont).toEqual(brand)
    expect(draftFont(next)).toBe(lora)
    expect(draftChanges(base, next)).toEqual(['Font'])
    const input = publishInput(base, next, published)!
    expect(input.theme?.customFont).toEqual(brand)
    expect(input.theme?.light?.fontSans).toBe(lora)
    expect(() => publishPortalCustomisationSchema.parse(input)).not.toThrow()
  })

  it('choosing a listed font removes it, even the font it falls back to', () => {
    const next = editTheme.setFont(withFont, lora)
    expect(next.customFont).toBeUndefined()
    expect(next.cssText).toBe(withFont.cssText)
    expect(themeChanged(withFont, next)).toBe(true)
    expect(draftChanges(withFont, next)).toEqual(['Font'])
    const input = publishInput(withFont, next, published)!
    expect(input.theme).not.toHaveProperty('customFont')
  })

  it('is named by its family in the panel', () => {
    expect(draftFontName(withFont)).toBe('Brand Sans')
    expect(draftFontName(base)).toBe('Inter')
  })
})

describe('the headings font', () => {
  const manrope = '"Manrope", ui-sans-serif, system-ui, sans-serif'
  const display = {
    family: 'Northwind Display',
    fallback: 'inter' as const,
    files: [{ key: 'fonts/2026/11/a-display-600.woff2', weight: 600, style: 'normal' as const }],
  }
  const published = publishedFromLoaded(loaded)

  it('is the text font until one is chosen', () => {
    expect(draftHeadingFont(base)).toBeNull()
    expect(draftHeadingName(base)).toBe('Same as text')
    expect(base.cssText).not.toContain('--font-heading')
  })

  it('a listed font is written on both sides as a theme line, and publishes on both', () => {
    const next = editTheme.setHeadingFont(base, manrope)
    expect(draftHeadingFont(next)).toBe(manrope)
    expect(draftHeadingName(next)).toBe('Manrope')
    expect(draftPalette(next, 'light').fontHeading).toBe(manrope)
    expect(draftPalette(next, 'dark').fontHeading).toBe(manrope)
    expect(advancedCssRemainder(next.cssText)).toBe('')
    expect(draftChanges(base, next)).toEqual(['Headings'])
    const input = publishInput(base, next, published)!
    expect(input.theme?.light?.fontHeading).toBe(manrope)
    expect(input.theme?.dark?.fontHeading).toBe(manrope)
    expect(input.customCss).toBe('')
    expect(() => publishPortalCustomisationSchema.parse(input)).not.toThrow()
  })

  it('round trips: a published heading font loads back as the draft’s', () => {
    const input = publishInput(base, editTheme.setHeadingFont(base, manrope), published)!
    const again = draftFromLoaded({ ...loaded, theme: input.theme as LoadedPortal['theme'] })
    expect(draftHeadingFont(again)).toBe(manrope)
    expect(draftFont(again)).toBe(draftFont(base))
  })

  it('goes back to the text font, leaving no line behind on either side', () => {
    const set = editTheme.setHeadingFont(base, manrope)
    const back = editTheme.setHeadingFont(set, null)
    expect(back.cssText).toBe(base.cssText)
    const input = publishInput(set, back, publishedFromLoaded(loaded))!
    expect(input.theme?.light).not.toHaveProperty('fontHeading')
    expect(input.theme?.dark).not.toHaveProperty('fontHeading')
  })

  it('a font set on one side only (by hand) never shows on the other', () => {
    const oneSide = draftFromLoaded({
      ...loaded,
      theme: { themeMode: 'user', light: { fontHeading: manrope } },
    })
    expect(oneSide.cssText.slice(oneSide.cssText.indexOf('.dark'))).toContain(
      '--font-heading: initial;'
    )
    // The stand-in is not a font: the dark side has none.
    expect(draftPalette(oneSide, 'dark').fontHeading).toBeUndefined()
    expect(draftPalette(oneSide, 'light').fontHeading).toBe(manrope)
  })

  it('keeps the text font, and the text font keeps it', () => {
    const lora = '"Lora", ui-serif, Georgia, serif'
    const next = editTheme.setFont(editTheme.setHeadingFont(base, manrope), lora)
    expect(draftHeadingFont(next)).toBe(manrope)
    expect(draftFont(next)).toBe(lora)
    expect(draftFont(editTheme.setHeadingFont(next, null))).toBe(lora)
  })

  it('an uploaded family is its own field, named by its family, and publishes', () => {
    const next = editTheme.setUploadedHeadingFont(editTheme.setHeadingFont(base, manrope), display)
    expect(next.customHeadingFont).toEqual(display)
    // The uploaded family takes the listed one's place.
    expect(draftHeadingFont(next)).toBeNull()
    expect(draftHeadingName(next)).toBe('Northwind Display')
    expect(themeChanged(base, next)).toBe(true)
    expect(draftChanges(base, next)).toEqual(['Headings'])
    const input = publishInput(base, next, published)!
    expect(input.theme?.customHeadingFont).toEqual(display)
    expect(() => publishPortalCustomisationSchema.parse(input)).not.toThrow()
    // A listed font, or the text font, takes it away again.
    expect(editTheme.setHeadingFont(next, null).customHeadingFont).toBeUndefined()
    expect(editTheme.setHeadingFont(next, manrope).customHeadingFont).toBeUndefined()
  })

  it('a publish of any theme change keeps a stored heading family', () => {
    const stored = draftFromLoaded({
      ...loaded,
      theme: { themeMode: 'user', customHeadingFont: display },
    })
    expect(stored.customHeadingFont).toEqual(display)
    const input = publishInput(stored, { ...stored, buttonShape: 'corners' }, published)!
    expect(input.theme?.customHeadingFont).toEqual(display)
  })
})

describe('the card style', () => {
  const published = publishedFromLoaded(loaded)

  it('is Border until another is chosen', () => {
    expect(base.cardStyle).toBe('border')
    expect(draftFromLoaded({ ...loaded, theme: { cardStyle: 'flat' } }).cardStyle).toBe('flat')
  })

  it('is a theme setting of its own: it changes no stylesheet line and publishes with the theme', () => {
    const next = editTheme.setCardStyle(base, 'shadow')
    expect(next.cssText).toBe(base.cssText)
    expect(themeChanged(base, next)).toBe(true)
    expect(draftChanges(base, next)).toEqual(['Cards'])
    const input = publishInput(base, next, published)!
    expect(input.theme?.cardStyle).toBe('shadow')
    expect(() => publishPortalCustomisationSchema.parse(input)).not.toThrow()
    const again = draftFromLoaded({ ...loaded, theme: input.theme as LoadedPortal['theme'] })
    expect(again.cardStyle).toBe('shadow')
  })

  it('choosing the style it has changes nothing', () => {
    expect(editTheme.setCardStyle(base, 'border')).toBe(base)
  })

  it('Border is stored as no setting at all', () => {
    const flat = draftFromLoaded({ ...loaded, theme: { themeMode: 'user', cardStyle: 'flat' } })
    const input = publishInput(flat, editTheme.setCardStyle(flat, 'border'), published)!
    expect(input.theme).not.toHaveProperty('cardStyle')
  })

  it('the schema refuses a style that is not one of the three', () => {
    const input = publishInput(base, editTheme.setCardStyle(base, 'shadow'), published)!
    const bad = { ...input, theme: { ...input.theme, cardStyle: 'glass' } }
    expect(() => publishPortalCustomisationSchema.parse(bad)).toThrow()
  })
})

describe('the logo’s dark mode version', () => {
  const WIDE = 'header-logos/2026/11/abc-wordmark.svg'
  const DARK = 'header-logos/2026/11/abc-wordmark-dark.svg'
  const withWide: LoadedPortal = { ...loaded, logo: { wideKey: WIDE, mode: 'custom_logo' } }
  const draft = draftFromLoaded(withWide)

  it('is no part of a draft until one is added, and loads when the workspace has one', () => {
    expect(draft.logo.darkKey ?? null).toBeNull()
    const has = draftFromLoaded({ ...withWide, logo: { ...withWide.logo!, darkKey: DARK } })
    expect(has.logo.darkKey).toBe(DARK)
  })

  it('an upload is one change to the logo, and publishes as the dark version alone', () => {
    const next = editLogo.setUploadedDark(draft, DARK)
    expect(next.logo).toMatchObject({ wideKey: WIDE, mode: 'custom_logo', darkKey: DARK })
    expect(draftChanges(draft, next)).toEqual(['Logo'])
    const input = publishInput(draft, next, publishedFromLoaded(withWide))!
    expect(input).toEqual({ before: { logo: { darkKey: null } }, logo: { darkKey: DARK } })
    expect(() => publishPortalCustomisationSchema.parse(input)).not.toThrow()
  })

  it('removing it publishes none; removing the logo takes its dark version with it', () => {
    const has: LoadedPortal = { ...withWide, logo: { ...withWide.logo!, darkKey: DARK } }
    const from = draftFromLoaded(has)
    const removed = editLogo.removeDark(from)
    expect(removed.logo.darkKey ?? null).toBeNull()
    expect(publishInput(from, removed, publishedFromLoaded(has))).toEqual({
      before: { logo: { darkKey: DARK } },
      logo: { darkKey: null },
    })
    expect(editLogo.removeDark(draft)).toBe(draft)
    const gone = publishInput(from, editLogo.removeWide(from), publishedFromLoaded(has))!
    expect(gone.logo).toMatchObject({ wideKey: null, darkKey: null })
  })
})

describe('a headings font for page headings only', () => {
  it('loads, publishes and reads as a theme setting of its own', () => {
    const scoped: LoadedPortal = {
      ...loaded,
      theme: {
        ...loaded.theme,
        headingScope: 'page',
        light: { ...loaded.theme.light, fontHeading: '"Lora", serif' },
      },
    }
    const draft = draftFromLoaded(scoped)
    expect(draft.headingScope).toBe('page')
    expect(base.headingScope).toBeUndefined()
    const input = publishInput(
      base,
      editTheme.setHeadingScope(editTheme.setHeadingFont(base, '"Lora", serif'), 'page'),
      publishedFromLoaded(loaded)
    )!
    expect(input.theme).toMatchObject({ headingScope: 'page' })
    expect(() => publishPortalCustomisationSchema.parse(input)).not.toThrow()
    // Unset is stored as no setting at all.
    const cleared = publishInput(
      draft,
      editTheme.setHeadingScope(draft, undefined),
      publishedFromLoaded(scoped)
    )!
    expect(cleared.theme).not.toHaveProperty('headingScope')
    expect(() =>
      publishPortalCustomisationSchema.parse({
        ...input,
        theme: { ...input.theme, headingScope: 'all' },
      })
    ).toThrow()
  })
})

describe('the name', () => {
  const named: LoadedPortal = { ...loaded, name: 'Acme Corp' }
  const draft = draftFromLoaded(named)
  const published = publishedFromLoaded(named)

  it('the header shows the workspace’s name until it has one of its own', () => {
    expect(draft.workspaceName).toBe('Acme Corp')
    expect(draft.headerName).toBe('')
    expect(shownName(draft)).toBe('Acme Corp')
    const set = draftFromLoaded({ ...named, headerName: 'Acme Feedback' })
    expect(shownName(set)).toBe('Acme Feedback')
    expect(base.workspaceName).toBe('')
  })

  it('a new header name is one change, and publishes as the header name alone', () => {
    const next = editHeaderName(draft, 'Northwind ')
    expect(shownName(next)).toBe('Northwind')
    // The workspace's own name is never part of the draft's changes.
    expect(next.workspaceName).toBe('Acme Corp')
    expect(draftChanges(draft, next)).toEqual(['Portal name'])
    const input = publishInput(draft, next, published)!
    expect(input).toEqual({ before: { headerName: '' }, headerName: 'Northwind' })
    expect(() => publishPortalCustomisationSchema.parse(input)).not.toThrow()
  })

  it('clearing it publishes an empty name, so the header shows the workspace’s again', () => {
    const set: LoadedPortal = { ...named, headerName: 'Northwind' }
    const from = draftFromLoaded(set)
    const next = editHeaderName(from, '')
    expect(shownName(next)).toBe('Acme Corp')
    expect(publishInput(from, next, publishedFromLoaded(set))).toEqual({
      before: { headerName: 'Northwind' },
      headerName: '',
    })
  })

  it('the same name, or spaces round it, changes nothing to publish', () => {
    expect(editHeaderName(draft, '')).toBe(draft)
    expect(publishInput(draft, editHeaderName(draft, '  '), published)).toBeNull()
  })
})

describe('darkSurfaceOf', () => {
  const draft = draftFromLoaded(loaded)

  it('is nothing for an always light portal: its logo is never drawn on a dark header', () => {
    expect(darkSurfaceOf({ ...draft, themeMode: 'light' })).toBeNull()
  })

  it('is the dark header where the portal can be dark', () => {
    const dark = editTheme.setColour(draft, 'background', 'dark', '#101418')
    expect(darkSurfaceOf({ ...dark, themeMode: 'user' })).toBe('#101418')
    expect(darkSurfaceOf({ ...dark, themeMode: 'dark' })).toBe('#101418')
    const barred = editTheme.setColour(dark, 'header', 'dark', '#1d70b8')
    expect(darkSurfaceOf({ ...barred, themeMode: 'user' })).toBe('#1d70b8')
  })
})
