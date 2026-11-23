/**
 * Import your brand applied to the draft: every value the site gave, through
 * the same writes the sections use, as one step; each result row can be
 * taken back on its own, leaving the others; the result rows say what was
 * matched, what stands in, and what is missing.
 */
import { describe, expect, it } from 'vitest'
import type { BrandImport } from '@/lib/shared/theme/brand-import'
import {
  draftFont,
  draftHeadingFont,
  draftHeadingName,
  draftChanges,
  draftFromLoaded,
  editHeaderName,
  draftPalette,
  draftRadius,
  draftRemainder,
  editTheme,
  type LoadedPortal,
  type PortalDraft,
} from '../portal-draft'
import {
  applyBrandImport,
  dropAsset,
  revertImport,
  stillUndone,
  importRows,
  importSuggestions,
  applySuggestion,
  welcomeLine,
  replaceImport,
  revertImportRow,
  siteColoursOf,
  takeBackRow,
  type PreviousImport,
} from '../brand-apply'

const loaded: LoadedPortal = {
  theme: { themeMode: 'user' },
  customCss: '.x { color: red; }',
  portal: {} as LoadedPortal['portal'],
  helpCenter: null,
}
const base = draftFromLoaded(loaded)

const sample: BrandImport = {
  host: 'example.com',
  reader: 'static',
  primary: '#533afd',
  background: '#ffffff',
  text: '#061b31',
  scheme: 'light',
  font: { site: 'Brand Sans', id: 'inter', exact: false },
  radius: 0.25,
  buttonShape: 'pill',
  buttonPx: 4,
  logo: {
    kind: 'wide',
    stagedKey: 'header-logos/2026/11/a-staged-import.svg',
    url: '/api/storage/header-logos/2026/11/a-staged-import.svg',
  },
  missing: [],
}

const apply = applyBrandImport
const replace = replaceImport

describe('applyBrandImport', () => {
  it('sets the logo, colours, font and shape, keeping the Advanced CSS', () => {
    const next = apply(base, sample)
    expect(next.logo).toEqual({ wideKey: sample.logo!.stagedKey, mode: 'custom_logo', icon: null })
    expect(draftPalette(next, 'light').primary).toBe('#533afd')
    expect(draftPalette(next, 'light').foreground).toBe('#061b31')
    expect(draftFont(next)).toContain('Inter')
    expect(draftRadius(next)).toBe(0.25)
    expect(next.buttonShape).toBe('pill')
    expect(draftRemainder(next)).toBe(draftRemainder(base))
  })

  it('makes the portal always dark for a dark site, its colours on the dark side', () => {
    const next = apply(base, {
      ...sample,
      scheme: 'dark',
      background: '#08090a',
      text: '#f7f8f8',
      primary: '#5e6ad2',
    })
    expect(next.themeMode).toBe('dark')
    expect(draftPalette(next, 'dark').background).toBe('#08090a')
    expect(draftPalette(next, 'dark').foreground).toBe('#f7f8f8')
    expect(draftPalette(next, 'dark').primary).toBe('#5e6ad2')
  })

  it('sets the site’s card, border and quieter text, and its dark mode, for visitors to choose', () => {
    const next = apply(base, {
      ...sample,
      tokens: { card: '#f6f9fc', border: '#e3e8ee', mutedForeground: '#425466' },
      darkMode: {
        background: '#0a2540',
        foreground: '#f6f9fc',
        primary: '#7a73ff',
        border: '#1d3a5c',
      },
    })
    expect(draftPalette(next, 'light')).toMatchObject({
      card: '#f6f9fc',
      border: '#e3e8ee',
      mutedForeground: '#425466',
      primary: '#533afd',
    })
    expect(draftPalette(next, 'dark')).toMatchObject({
      background: '#0a2540',
      foreground: '#f6f9fc',
      primary: '#7a73ff',
      border: '#1d3a5c',
    })
    expect(next.themeMode).toBe('user')
    expect(draftRemainder(next)).toBe(draftRemainder(base))
  })

  it('follows the site: always light for a light site with no dark mode of its own', () => {
    for (const themeMode of ['user', 'dark', 'light'] as const)
      expect(apply({ ...base, themeMode }, sample).themeMode).toBe('light')
  })

  it('follows the site: the visitor’s choice for a light site with a dark mode of its own', () => {
    const withDark: BrandImport = {
      ...sample,
      darkMode: { background: '#0a2540', foreground: '#f6f9fc' },
    }
    for (const themeMode of ['user', 'dark', 'light'] as const)
      expect(apply({ ...base, themeMode }, withDark).themeMode).toBe('user')
  })

  it('leaves the mode alone when no page colour was read', () => {
    const next = apply({ ...base, themeMode: 'user' }, { ...sample, background: undefined })
    expect(next.themeMode).toBe('user')
  })

  it('undoes what an earlier dark import forced when a light site is imported over it', () => {
    const nexus = apply(base, {
      ...sample,
      scheme: 'dark',
      background: '#0f0f10',
      text: '#fafafa',
      primary: '#fb923c',
    })
    expect(nexus.themeMode).toBe('dark')
    const mailchimp = apply(nexus, {
      ...sample,
      scheme: 'light',
      background: '#ffffff',
      text: undefined,
      primary: '#ffe01b',
    })
    // Not stuck dark, and nothing of the dark site left on the dark side.
    expect(mailchimp.themeMode).toBe('light')
    expect(draftPalette(mailchimp, 'dark').background).toBe(draftPalette(base, 'dark').background)
    expect(draftPalette(mailchimp, 'dark').primary).not.toBe('#fb923c')
    expect(draftPalette(mailchimp, 'light').primary).toBe('#ffe01b')
  })

  it('leaves what the site did not give', () => {
    const next = apply(base, {
      host: 'x.example',
      reader: 'static',
      font: { id: 'inter', exact: false },
      missing: ['logo', 'colour', 'page', 'shape'],
    })
    expect(next.logo).toEqual(base.logo)
    expect(draftPalette(next, 'light')).toEqual(draftPalette(base, 'light'))
    expect(next.buttonShape).toBe(base.buttonShape)
  })

  const icon = {
    key: 'logos/2026/11/a-staged-import.png',
    faviconKey: 'favicons/2026/11/a-staged-import.png',
    url: '/api/storage/logos/2026/11/a-staged-import.png',
  }

  it('sets the logo and the icon together', () => {
    const next = apply(base, { ...sample, icon })
    expect(next.logo).toEqual({
      wideKey: sample.logo!.stagedKey,
      mode: 'custom_logo',
      icon: { key: icon.key, faviconKey: icon.faviconKey },
    })
  })

  it('shows a square logo (a mark alone) as the icon and name when there is an icon', () => {
    const square = { ...sample.logo!, kind: 'square' as const }
    expect(apply(base, { ...sample, logo: square, icon }).logo.mode).toBe('logo_and_name')
    // With no icon to show, the mark stands alone.
    expect(apply(base, { ...sample, logo: square }).logo.mode).toBe('custom_logo')
  })
})

describe('replaceImport', () => {
  const nexus: BrandImport = {
    ...sample,
    host: 'nexusmods.com',
    scheme: 'dark',
    background: '#0f0f10',
    text: '#fafafa',
    primary: '#fb923c',
    font: { site: 'Inter', id: 'inter', exact: true },
    logo: { kind: 'wide', stagedKey: 'header-logos/nexus.svg', url: '/n.svg' },
    icon: { key: 'logos/nexus.png', faviconKey: 'favicons/nexus.png', url: '/n.png' },
  }
  const mailchimp: BrandImport = {
    ...sample,
    host: 'mailchimp.com',
    scheme: 'light',
    background: '#ffffff',
    text: undefined,
    primary: '#ffe01b',
    logo: undefined,
    icon: undefined,
    missing: ['logo', 'icon'],
  }

  it('gives the same draft whatever was imported before: a new import replaces the last', () => {
    const first = replace(base, null, nexus)
    const second = replace(
      first.next,
      { brand: nexus, before: first.before, undone: [] },
      mailchimp
    )
    const alone = replace(base, null, mailchimp)
    expect(second.next).toEqual(alone.next)
    // Its rows' Undo goes back to the person's own draft, not to the last import's.
    expect(second.before).toEqual(base)
  })

  it('keeps what the person set where the new site says nothing', () => {
    const own = {
      ...base,
      logo: { ...base.logo, wideKey: 'header-logos/mine.svg', mode: 'custom_logo' as const },
    }
    const first = replace(own, null, nexus)
    expect(first.next.logo.wideKey).toBe('header-logos/nexus.svg')
    const second = replace(
      first.next,
      { brand: nexus, before: first.before, undone: [] },
      mailchimp
    )
    expect(second.next.logo.wideKey).toBe('header-logos/mine.svg')
  })

  it('rebuilds an area the site gives from the default, not on top of what was there', () => {
    const tinted = apply(base, {
      ...sample,
      tokens: { card: '#f6f9fc', border: '#e3e8ee' },
    })
    const next = replace(tinted, null, { ...sample, tokens: undefined }).next
    expect(draftPalette(next, 'light').card).toBe(draftPalette(apply(base, sample), 'light').card)
  })

  it('takes back a header bar the next site does not have', () => {
    const nhs: BrandImport = { ...sample, host: 'nhs.uk', tokens: { header: '#005eb8' } }
    const first = replace(base, null, nhs)
    expect(draftPalette(first.next, 'light').header).toBe('#005eb8')
    expect(importRows(nhs).find((row) => row.key === 'page')?.swatches).toContain('#005eb8')
    const second = replace(first.next, { brand: nhs, before: first.before, undone: [] }, sample)
    expect(draftPalette(second.next, 'light').header).toBeUndefined()
    // A header the person set themselves goes when a site gives the page.
    const own = editTheme.setColour(base, 'header', 'light', '#171717')
    expect(draftPalette(apply(own, sample), 'light').header).toBeUndefined()
  })

  it('drops an uploaded font for another family, and keeps one the site uses', () => {
    const uploaded = {
      ...base,
      customFont: {
        family: 'Brand Sans',
        fallback: 'inter' as const,
        files: [{ key: 'fonts/s.woff2', weight: 400, style: 'normal' as const }],
      },
    }
    expect(
      replace(uploaded, null, {
        ...sample,
        font: { site: 'Tally', id: 'inter', exact: false },
      }).next.customFont
    ).toBeUndefined()
    expect(
      replace(uploaded, null, {
        ...sample,
        font: { site: 'Brand Sans', id: 'inter', exact: false },
      }).next.customFont
    ).toEqual(uploaded.customFont)
  })
})

describe('revertImportRow', () => {
  const imported = apply(base, sample)

  it('takes one row back, leaving the others', () => {
    const noShape = revertImportRow(imported, base, 'shape')
    expect(draftRadius(noShape)).toBe(draftRadius(base))
    expect(noShape.buttonShape).toBe(base.buttonShape)
    expect(draftPalette(noShape, 'light').primary).toBe('#533afd')

    const noLogo = revertImportRow(imported, base, 'logo')
    expect(noLogo.logo).toEqual(base.logo)
    expect(draftRadius(noLogo)).toBe(0.25)

    const both = apply(base, {
      ...sample,
      icon: { key: 'logos/i.png', faviconKey: 'favicons/i.png', url: '/api/storage/logos/i.png' },
    })
    const noIcon = revertImportRow(both, base, 'icon')
    expect(noIcon.logo).toEqual({ ...both.logo, icon: base.logo.icon })
    expect(revertImportRow(both, base, 'logo').logo.icon).toEqual(both.logo.icon)
  })

  it('takes the main colour, the page colours and the font back', () => {
    const noPrimary = revertImportRow(imported, base, 'primary')
    expect(draftPalette(noPrimary, 'light').primary).toBe(draftPalette(base, 'light').primary)
    expect(draftPalette(noPrimary, 'light').foreground).toBe('#061b31')

    const noPage = revertImportRow(imported, base, 'page')
    expect(draftPalette(noPage, 'light').foreground).toBe(draftPalette(base, 'light').foreground)
    expect(noPage.themeMode).toBe(base.themeMode)
    expect(draftPalette(noPage, 'light').primary).toBe('#533afd')

    const paletted = apply(base, {
      ...sample,
      tokens: { card: '#f6f9fc', border: '#e3e8ee', mutedForeground: '#425466' },
      darkMode: { background: '#0a2540', primary: '#7a73ff' },
    })
    const unpaletted = revertImportRow(paletted, base, 'page')
    for (const side of ['light', 'dark'] as const)
      for (const key of ['background', 'card', 'border', 'mutedForeground'] as const)
        expect(draftPalette(unpaletted, side)[key]).toBe(draftPalette(base, side)[key])
    expect(draftPalette(revertImportRow(paletted, base, 'primary'), 'dark').primary).toBe(
      draftPalette(base, 'dark').primary
    )

    const noFont = revertImportRow(
      apply(base, { ...sample, font: { id: 'lora', exact: true } }),
      base,
      'font'
    )
    expect(draftFont(noFont)).toBe(draftFont(base))
  })
})

describe('importRows', () => {
  it('says what was matched, what stands in and what is missing', () => {
    const rows = importRows(sample)
    expect(rows.map((r) => [r.key, r.state, r.text])).toEqual([
      ['logo', 'matched', 'From the site'],
      ['icon', 'missing', 'No square icon of 120 px or more.'],
      ['primary', 'matched', '#533afd'],
      ['page', 'matched', 'Always light'],
      // No file of it was read: nothing is claimed of its licence.
      ['font', 'nearest', 'Brand Sans isn’t one we have, so Inter stands in.'],
      ['headings', 'skipped', 'Same as the text font.'],
      ['cards', 'skipped', 'No clear style found. Yours stays.'],
      ['shape', 'matched', 'Slight corners, pill buttons'],
    ])
    expect(rows.map((r) => r.label)).toEqual([
      'Logo',
      'Icon',
      'Main colour',
      'Page and text',
      'Text font',
      'Headings',
      'Cards',
      'Shape',
    ])
    expect(rows.find((r) => r.key === 'font')?.uploadFont).toBe('Brand Sans')
  })

  it('shows the logo, icon and copied font as applied at once, like the colours', () => {
    const rows = importRows({ ...sample, icon: northwindIcon })
    expect(rows.slice(0, 2).map((r) => [r.key, r.state, r.text, r.applied])).toEqual([
      ['logo', 'matched', 'From the site', true],
      ['icon', 'matched', 'The site’s app icon', true],
    ])
    expect(
      importRows(withAssets)
        .filter((r) => r.applied)
        .map((r) => r.key)
    ).toEqual(['logo', 'icon', 'primary', 'page', 'font', 'shape'])
  })

  it('words the font row for each way the site’s font can come', () => {
    const fontRow = (siteFont: BrandImport['siteFont']) => {
      const row = importRows({ ...sample, siteFont }).find((r) => r.key === 'font')!
      return [row.state, row.text, row.applied, row.uploadFont]
    }
    const files = [{ key: 'fonts/s.woff2', weight: 400, style: 'normal' as const }]
    expect(fontRow({ family: 'Brand Sans', licence: 'commercial', files })).toEqual([
      'matched',
      'Brand Sans, from the site',
      true,
      undefined,
    ])
    expect(fontRow({ family: 'Brand Sans', licence: 'open', files })).toEqual([
      'matched',
      'Brand Sans, from the site',
      true,
      undefined,
    ])
    for (const notCopied of ['service', 'restricted'] as const)
      expect(fontRow({ family: 'Brand Sans', notCopied })).toEqual([
        'nearest',
        'Can’t be copied. Inter stands in.',
        true,
        'Brand Sans',
      ])
    expect(fontRow({ family: 'Brand Sans', notCopied: 'subset' })[1]).toBe(
      'Not copied: the site serves only part of it. Inter stands in.'
    )
    expect(fontRow({ family: 'Brand Sans', notCopied: 'too-large' })[1]).toBe(
      'Not copied: its files are over 400 KB. Inter stands in.'
    )
  })

  it('words the gaps', () => {
    const rows = importRows({
      host: 'x.example',
      reader: 'static',
      scheme: 'dark',
      background: '#08090a',
      text: '#f7f8f8',
      font: { site: 'Inter', id: 'inter', exact: true },
      buttonShape: 'corners',
      buttonPx: 4,
      radius: 0.25,
      missing: ['logo', 'colour'],
    })
    const text = Object.fromEntries(rows.map((r) => [r.key, [r.state, r.text]]))
    expect(text.logo).toEqual(['missing', 'Not found on the site.'])
    expect(text.primary).toEqual(['missing', 'No main colour found.'])
    expect(text.page).toEqual(['matched', 'Always dark'])
    expect(text.font).toEqual(['matched', 'Inter, same as the site'])
    expect(text.shape).toEqual(['matched', 'Buttons with 4px corners'])
  })

  it('says a light site with no dark mode makes the portal always light', () => {
    const page = importRows(sample).find((r) => r.key === 'page')
    expect(page?.text).toBe('Always light')
  })

  it('shows the site’s palette on the page row, and says when it brought a dark mode', () => {
    const page = importRows({
      ...sample,
      tokens: { card: '#f6f9fc', border: '#e3e8ee', mutedForeground: '#425466' },
      darkMode: { background: '#0a2540' },
    }).find((r) => r.key === 'page')
    expect(page).toMatchObject({
      text: 'Light and dark',
      swatches: ['#ffffff', '#061b31', '#f6f9fc', '#e3e8ee', '#425466', '#0a2540'],
    })
  })

  it('says the person’s own logo and icon stay where the site has none', () => {
    const rows = importRows(
      { ...sample, logo: undefined, missing: ['logo', 'icon'] },
      { logo: true, icon: true }
    )
    const text = Object.fromEntries(rows.map((row) => [row.key, row.text]))
    expect(text.logo).toBe('Not found. Your logo stays.')
    expect(text.icon).toBe('None found. Your icon stays.')
  })

  it('says the icon came from the site, or why there is none', () => {
    const rowFor = (brand: BrandImport) => importRows(brand).find((row) => row.key === 'icon')
    expect(
      rowFor({
        ...sample,
        icon: { key: 'logos/i.png', faviconKey: 'favicons/i.png', url: '/i.png' },
      })
    ).toMatchObject({ state: 'matched', text: 'The site’s app icon', applied: true })
    expect(rowFor({ ...sample, iconBlocked: 'permission' })).toMatchObject({
      state: 'missing',
      text: 'Only an owner can change the icon.',
    })
  })
})

describe('siteColoursOf', () => {
  it('offers the colours the site gave, each once', () => {
    expect(siteColoursOf(sample)).toEqual(['#533afd', '#ffffff', '#061b31'])
    expect(siteColoursOf(null)).toEqual([])
  })

  it('offers the site’s neutrals and dark mode colours too', () => {
    expect(
      siteColoursOf({
        ...sample,
        tokens: { border: '#e3e8ee', mutedForeground: '#425466' },
        darkMode: { background: '#0a2540', primary: '#7a73ff' },
      })
    ).toEqual(['#533afd', '#ffffff', '#061b31', '#e3e8ee', '#425466', '#0a2540', '#7a73ff'])
  })
})

const northwindIcon = { key: 'logos/n.png', faviconKey: 'favicons/n.png', url: '/n.png' }
const sohneFiles = [
  { key: 'fonts/2026/11/r-staged-import.woff2', weight: 400, style: 'normal' as const },
  { key: 'fonts/2026/11/b-staged-import.woff2', weight: 700, style: 'normal' as const },
]
const withAssets: BrandImport = {
  ...sample,
  font: { site: 'Brand Sans', id: 'lora', exact: false },
  icon: northwindIcon,
  siteFont: { family: 'Brand Sans', licence: 'commercial', files: sohneFiles },
}
const sohne = { family: 'Brand Sans', fallback: 'lora', files: sohneFiles }

describe('brand assets', () => {
  it('apply at once with the colours: the copied font with the nearest listed font behind it', () => {
    const next = applyBrandImport(base, withAssets)
    expect(next.logo).toEqual({
      wideKey: sample.logo!.stagedKey,
      mode: 'custom_logo',
      icon: { key: northwindIcon.key, faviconKey: northwindIcon.faviconKey },
    })
    expect(next.customFont).toEqual(sohne)
    expect(draftFont(next)).toContain('Lora')
    expect(draftPalette(next, 'light').primary).toBe('#533afd')
    expect(draftRadius(next)).toBe(0.25)
  })

  it('keeps a family the person uploaded themselves over the site’s copy of it', () => {
    const own = { family: 'Brand Sans', fallback: 'lora' as const, files: [sohneFiles[0]!] }
    expect(applyBrandImport({ ...base, customFont: own }, withAssets).customFont).toEqual(own)
  })

  it('drops one asset at a time, back to the draft from before, the others staying', () => {
    const before = {
      ...base,
      logo: {
        wideKey: 'header-logos/mine.svg',
        mode: 'custom_logo' as const,
        icon: { key: 'logos/mine.png', faviconKey: 'favicons/mine.png' },
      },
    }
    const applied = applyBrandImport(before, withAssets)
    const noLogo = dropAsset(applied, before, withAssets, 'logo')
    expect(noLogo.logo.wideKey).toBe('header-logos/mine.svg')
    expect(noLogo.logo.icon?.key).toBe(northwindIcon.key)
    expect(noLogo.customFont).toEqual(sohne)
    const noIcon = dropAsset(noLogo, before, withAssets, 'icon')
    expect(noIcon.logo).toEqual(before.logo)
    const noFont = dropAsset(noIcon, before, withAssets, 'font')
    expect(noFont.customFont).toBeUndefined()
    expect(draftFont(noFont)).toBe(draftFont(before))
    // The colours and shape stay.
    expect(draftPalette(noFont, 'light').primary).toBe('#533afd')
    expect(draftRadius(noFont)).toBe(0.25)
  })

  it('dropping leaves alone what the person has changed since', () => {
    const applied = applyBrandImport(base, withAssets)
    const mine = {
      ...applied,
      logo: { ...applied.logo, wideKey: 'header-logos/mine.svg' },
      customFont: {
        family: 'Mine',
        fallback: 'inter' as const,
        files: [{ key: 'fonts/mine.woff2', weight: 400, style: 'normal' as const }],
      },
    }
    expect(dropAsset(mine, base, withAssets, 'logo')).toBe(mine)
    expect(dropAsset(mine, base, withAssets, 'font')).toBe(mine)
    // The icon was still the site's: it goes.
    expect(dropAsset(mine, base, withAssets, 'icon').logo.icon).toBeNull()
  })

  it('a square logo shows as icon and name; without its icon, the logo shows alone again', () => {
    const square: BrandImport = { ...withAssets, logo: { ...sample.logo!, kind: 'square' } }
    const applied = applyBrandImport(base, square)
    expect(applied.logo.mode).toBe('logo_and_name')
    const noIcon = dropAsset(applied, base, square, 'icon')
    expect(noIcon.logo).toEqual(applyBrandImport(base, { ...square, icon: undefined }).logo)
    expect(noIcon.logo.mode).toBe('custom_logo')
    // The row's own Undo does the same.
    expect(takeBackRow(applied, base, square, 'icon').logo).toEqual(noIcon.logo)
    expect(dropAsset(applied, base, square, 'logo').logo).toEqual({
      ...base.logo,
      icon: applied.logo.icon,
    })
  })

  it('drops the text font and the headings font apart: two families, two assets', () => {
    const headingFiles = [
      { key: 'fonts/2026/11/h-staged-import.woff2', weight: 600, style: 'normal' as const },
    ]
    const two: BrandImport = {
      ...withAssets,
      headings: { site: 'Brand Display' },
      siteHeadingFont: { family: 'Brand Display', licence: 'commercial', files: headingFiles },
    }
    const applied = applyBrandImport(base, two)
    expect(applied.customHeadingFont?.family).toBe('Brand Display')
    const headingsOnly = dropAsset(applied, base, two, 'font')
    expect(headingsOnly.customFont).toEqual(base.customFont)
    expect(headingsOnly.customHeadingFont?.family).toBe('Brand Display')
    const textOnly = dropAsset(applied, base, two, 'headingFont')
    expect(textOnly.customFont).toEqual(sohne)
    expect(textOnly.customHeadingFont).toBeUndefined()
  })

  it('takes a whole import back in one, leaving rows already undone alone', () => {
    const applied = applyBrandImport(base, withAssets)
    const previous = { brand: withAssets, before: base, undone: [] }
    expect(revertImport(applied, previous)).toEqual(base)
    // A row the person took back already, then set by hand, stays as they set it.
    const own = editTheme.setRadius(revertImportRow(applied, base, 'shape'), 1)
    expect(draftRadius(revertImport(own, { ...previous, undone: ['shape'] }))).toBe(1)
  })

  it('reads a row taken back as in again once the editor’s undo brings its value back', () => {
    const next = applyBrandImport(base, sample)
    const undone = revertImportRow(next, base, 'primary')
    expect(stillUndone(undone, base, ['primary'])).toEqual(['primary'])
    // The editor's undo: the draft is the import's again.
    expect(stillUndone(next, base, ['primary'])).toEqual([])
  })

  it('a new import takes back only what the last one applied: never a logo set by hand since', () => {
    const first = replaceImport(base, null, withAssets)
    const mine = { ...first.next, logo: { ...first.next.logo, wideKey: 'header-logos/mine.svg' } }
    const second = replaceImport(
      mine,
      { brand: withAssets, before: first.before, undone: ['logo'] },
      { ...sample, logo: undefined, missing: ['logo'] }
    )
    expect(second.next.logo.wideKey).toBe('header-logos/mine.svg')
  })

  it('a new import takes back the last one’s logo and copied font', () => {
    const first = replaceImport(base, null, withAssets)
    const second = replaceImport(
      first.next,
      { brand: withAssets, before: first.before, undone: [] },
      { ...sample, logo: undefined, missing: ['logo'], font: { id: 'lora', exact: true } }
    )
    expect(second.next.logo).toEqual(base.logo)
    expect(second.next.customFont).toBeUndefined()
    expect(draftFont(second.next)).toContain('Lora')
  })

  it('taking the font row back restores the font from before, copied or not', () => {
    const applied = applyBrandImport(base, withAssets)
    const back = revertImportRow(applied, base, 'font')
    expect(back.customFont).toBeUndefined()
    expect(draftFont(back)).toBe(draftFont(base))
  })
})

describe('the site’s own dark mode logo', () => {
  const DARK = 'header-logos/2026/11/imported-dark.svg'
  const withDark: BrandImport = {
    ...sample,
    logoDark: { stagedKey: DARK, url: `/api/storage/${DARK}` },
  }

  it('goes into the draft with the logo, and says so', () => {
    const applied = apply(base, withDark)
    expect(applied.logo).toMatchObject({ wideKey: sample.logo!.stagedKey, darkKey: DARK })
    expect(importRows(withDark).find((r) => r.key === 'logo')!.text).toBe(
      'With its dark mode version'
    )
    expect(importRows(sample).find((r) => r.key === 'logo')!.text).toBe('From the site')
  })

  it('dropping the logo after the light one was changed by hand takes the site’s dark one alone', () => {
    const applied = apply(base, withDark)
    const mine = { ...applied, logo: { ...applied.logo, wideKey: 'header-logos/mine.svg' } }
    const dropped = dropAsset(mine, base, withDark, 'logo')
    expect(dropped.logo.wideKey).toBe('header-logos/mine.svg')
    expect(dropped.logo.darkKey ?? null).toBeNull()
  })

  it('an imported logo with no dark version of its own drops the one the old logo had', () => {
    const mine = {
      ...base,
      logo: {
        ...base.logo,
        wideKey: 'header-logos/mine.svg',
        darkKey: 'header-logos/mine-dark.svg',
      },
    }
    const applied = apply(mine, sample)
    expect(applied.logo.wideKey).toBe(sample.logo!.stagedKey)
    expect(applied.logo.darkKey ?? null).toBeNull()
    // Taking the logo back brings both back.
    expect(revertImportRow(applied, mine, 'logo').logo).toMatchObject({
      wideKey: 'header-logos/mine.svg',
      darkKey: 'header-logos/mine-dark.svg',
    })
    expect(revertImportRow(apply(base, withDark), base, 'logo').logo.darkKey ?? null).toBeNull()
  })
})

describe('the headings font', () => {
  const MANROPE = '"Manrope", ui-sans-serif, system-ui, sans-serif'
  const files = [
    { key: 'fonts/2026/11/h-600.woff2', weight: 600, style: 'normal' as const },
    { key: 'fonts/2026/11/h-700.woff2', weight: 700, style: 'normal' as const },
  ]
  const listed: BrandImport = { ...sample, headings: { site: 'Manrope', id: 'manrope' } }
  const copied = (licence: 'open' | 'commercial'): BrandImport => ({
    ...sample,
    headings: { site: 'Northwind Display' },
    siteHeadingFont: { family: 'Northwind Display', licence, files },
  })
  const display = { family: 'Northwind Display', files, fallback: 'inter' as const }
  const row = (brand: BrandImport) => {
    const found = importRows(brand).find((r) => r.key === 'headings')!
    return [found.state, found.text, found.applied]
  }

  it('sets a font the portal has, and says so', () => {
    const next = apply(base, listed)
    expect(draftHeadingFont(next)).toBe(MANROPE)
    expect(next.customHeadingFont).toBeUndefined()
    // The text font is its own row and stays what the site's text gave.
    expect(draftFont(next)).toContain('Inter')
    expect(row(listed)).toEqual(['matched', 'Manrope, same as the site', true])
  })

  it('sets a family copied from the site, open-licence or commercial', () => {
    for (const licence of ['open', 'commercial'] as const) {
      const next = applyBrandImport(base, copied(licence))
      expect(next.customHeadingFont).toEqual(display)
      expect(draftHeadingName(next)).toBe('Northwind Display')
      expect(row(copied(licence))).toEqual(['matched', 'Northwind Display, from the site', true])
    }
    // Only a commercial one is an asset Publish asks about; dropping it takes it back.
    const commercial = copied('commercial')
    const dropped = dropAsset(applyBrandImport(base, commercial), base, commercial, 'headingFont')
    expect(dropped.customHeadingFont).toBeUndefined()
    const open = copied('open')
    const kept = applyBrandImport(base, open)
    expect(dropAsset(kept, base, open, 'headingFont')).toBe(kept)
  })

  it('stays Same as text when the family can’t be copied: no substitute', () => {
    const cases: BrandImport[] = [
      { ...sample, headings: { site: 'Northwind Display' } },
      {
        ...sample,
        headings: { site: 'Northwind Display' },
        siteHeadingFont: { family: 'Northwind Display', notCopied: 'service' },
      },
      {
        ...sample,
        headings: { site: 'Northwind Display' },
        siteHeadingFont: { family: 'Northwind Display', notCopied: 'restricted' },
      },
    ]
    for (const brand of cases) {
      const next = apply(base, brand)
      expect(draftHeadingFont(next)).toBeNull()
      expect(next.customHeadingFont).toBeUndefined()
      expect(draftHeadingName(next)).toBe('Same as text')
      // No file read says nothing of a licence; a refusal the read gave says why.
      const why = brand.siteHeadingFont
        ? 'Can’t be copied.'
        : 'Northwind Display isn’t one we have.'
      expect(row(brand)).toEqual(['skipped', `${why} They match the text font.`, false])
    }
  })

  it('sets a face the site draws only large on page headings alone, and says so', () => {
    const large: BrandImport = {
      ...copied('open'),
      headings: { site: 'Northwind Display', display: true },
    }
    const applied = apply(base, large)
    expect(applied.headingScope).toBe('page')
    expect(row(large)).toEqual(['matched', 'Northwind Display, on page headings', true])
    // A listed font likewise.
    const listedLarge = { ...listed, headings: { ...listed.headings!, display: true } }
    expect(apply(base, listedLarge).headingScope).toBe('page')
    // A headings face drawn at every size sets every title, as before.
    expect(apply(base, copied('open')).headingScope).toBeUndefined()
    // Taking the row back, or choosing a headings font by hand, ends it.
    expect(revertImportRow(applied, base, 'headings').headingScope).toBeUndefined()
    expect(editTheme.setHeadingFont(applied, MANROPE).headingScope).toBeUndefined()
    // It publishes as part of the theme, and is one change.
    expect(draftChanges(apply(base, copied('open')), applied)).toEqual(['Headings'])
  })

  it('says nothing was needed when the site sets its headings in the text font', () => {
    expect(row(sample)).toEqual(['skipped', 'Same as the text font.', false])
    // What the person chose themselves stays.
    const own = editTheme.setHeadingFont(base, MANROPE)
    expect(draftHeadingFont(apply(own, sample))).toBe(MANROPE)
  })

  it('takes the row back to the headings from before, listed or uploaded', () => {
    const own = editTheme.setHeadingFont(base, '"Lora", ui-serif, Georgia, serif')
    const applied = apply(own, listed)
    expect(draftHeadingFont(revertImportRow(applied, own, 'headings'))).toContain('Lora')
    const reverted = revertImportRow(apply(base, copied('open')), base, 'headings')
    expect(reverted.customHeadingFont).toBeUndefined()
    expect(reverted.cssText).toBe(apply(base, copied('open')).cssText)
    const uploaded = { ...base, customHeadingFont: { ...display, family: 'Own Display' } }
    expect(
      revertImportRow(apply(uploaded, listed), uploaded, 'headings').customHeadingFont
    ).toEqual(uploaded.customHeadingFont)
    // The other rows stay.
    expect(draftPalette(revertImportRow(applied, own, 'headings'), 'light').primary).toBe('#533afd')
  })

  it('a new import takes the last one’s headings back first', () => {
    const first = replace(base, null, listed)
    const previous: PreviousImport = {
      brand: listed,
      before: first.before,
      undone: [],
    }
    const second = replace(first.next, previous, sample)
    expect(draftHeadingFont(second.next)).toBeNull()
    expect(second.next).toEqual(replace(base, null, sample).next)
    // Taken back by hand, it is not taken back twice.
    const undone = revertImportRow(first.next, first.before, 'headings')
    const own = editTheme.setHeadingFont(undone, '"Lora", ui-serif, Georgia, serif')
    const kept = replace(own, { ...previous, undone: ['headings'] }, sample)
    expect(draftHeadingFont(kept.next)).toContain('Lora')
  })
})

describe('the card style', () => {
  const shadowed: BrandImport = { ...sample, cardStyle: 'shadow' }
  const row = (brand: BrandImport) => {
    const found = importRows(brand).find((r) => r.key === 'cards')!
    return [found.state, found.text, found.applied]
  }

  it('sets the style the site’s cards clearly share', () => {
    expect(apply(base, shadowed).cardStyle).toBe('shadow')
    expect(row(shadowed)).toEqual(['matched', 'Shadow, like the site', true])
    expect(row({ ...sample, cardStyle: 'flat' })).toEqual(['matched', 'Flat, like the site', true])
    expect(row({ ...sample, cardStyle: 'border' })).toEqual([
      'matched',
      'Border, like the site',
      true,
    ])
  })

  it('leaves the person’s style where the site is not clear', () => {
    const own = editTheme.setCardStyle(base, 'flat')
    expect(apply(own, sample).cardStyle).toBe('flat')
    expect(row(sample)).toEqual(['skipped', 'No clear style found. Yours stays.', false])
  })

  it('takes the row back, and a new import takes it back first', () => {
    const own = editTheme.setCardStyle(base, 'flat')
    const applied = apply(own, shadowed)
    expect(revertImportRow(applied, own, 'cards').cardStyle).toBe('flat')
    const first = replace(base, null, shadowed)
    const second = replace(
      first.next,
      { brand: shadowed, before: first.before, undone: [] },
      sample
    )
    expect(second.next.cardStyle).toBe('border')
  })
})

describe('suggested words', () => {
  const named = { ...base, workspaceName: 'Acme Corp' }
  const northwind: BrandImport = { ...sample, siteName: 'Northwind' }
  const texts = (draft: PortalDraft, before: PortalDraft, brand: BrandImport) =>
    importSuggestions(brand, before, draft).map((s) => [s.key, s.text, s.used])

  it('offers the site’s name and a welcome line, neither applied', () => {
    expect(texts(named, named, northwind)).toEqual([
      ['name', 'Northwind, now Acme Corp', false],
      ['welcome', 'Tell us what would make Northwind better for your team.', false],
    ])
    // An import never applies them.
    expect(apply(named, northwind).headerName).toBe('')
    expect(apply(named, northwind).workspaceName).toBe('Acme Corp')
    expect(apply(named, northwind).welcomeBody).toEqual(named.welcomeBody)
  })

  it('offers the name only when the header does not show it already', () => {
    const same = { ...base, workspaceName: 'northwind ' }
    expect(importSuggestions(northwind, same, same).map((s) => s.key)).toEqual(['welcome'])
    const set = { ...named, headerName: 'Northwind' }
    expect(importSuggestions(northwind, set, set).map((s) => s.key)).toEqual(['welcome'])
    expect(importSuggestions(sample, named, named).map((s) => s.key)).toEqual(['welcome'])
  })

  it('calls it the portal name, and compares with the name the header shows now', () => {
    const set = { ...named, headerName: 'Acme Feedback' }
    expect(importSuggestions(northwind, set, set)[0]).toMatchObject({
      label: 'Portal name',
      text: 'Northwind, now Acme Feedback',
    })
  })

  it('writes the welcome line about a feedback board, with the site’s name, else the workspace’s', () => {
    expect(welcomeLine('Northwind')).toBe('Tell us what would make Northwind better for your team.')
    expect(texts(named, named, sample)[0]).toEqual([
      'welcome',
      'Tell us what would make Acme Corp better for your team.',
      false,
    ])
    // With no name at all there is no line to offer.
    expect(importSuggestions(sample, base, base)).toEqual([])
  })

  it('using the name sets the header’s only, and shows it as used until it is undone', () => {
    const used = applySuggestion(named, northwind, 'name')
    expect(used.headerName).toBe('Northwind')
    // The workspace keeps its own name, for emails and sign-in.
    expect(used.workspaceName).toBe('Acme Corp')
    expect(texts(used, named, northwind)[0]).toEqual(['name', 'Northwind', true])
    // Undone (the draft is as before), it is offered again.
    expect(texts(named, named, northwind)[0]).toEqual(['name', 'Northwind, now Acme Corp', false])
    expect(editHeaderName(used, '')).toEqual(named)
  })

  it('using the welcome line writes it as the message’s first paragraph, keeping a heading', () => {
    const heading = {
      type: 'heading',
      attrs: { level: 2 },
      content: [{ type: 'text', text: 'Welcome' }],
    }
    const body = {
      type: 'doc',
      content: [heading, { type: 'paragraph', content: [{ type: 'text', text: 'Share ideas.' }] }],
    } as PortalDraft['welcomeBody']
    const used = applySuggestion({ ...named, welcomeBody: body }, northwind, 'welcome')
    expect(used.welcomeBody).toEqual({
      type: 'doc',
      content: [
        heading,
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Tell us what would make Northwind better for your team.' },
          ],
        },
      ],
    })
    expect(texts(used, named, northwind)[1]![2]).toBe(true)
    // A hidden (empty) message becomes the line alone.
    const empty = applySuggestion(named, northwind, 'welcome')
    expect(empty.welcomeBody).toEqual({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Tell us what would make Northwind better for your team.' },
          ],
        },
      ],
    })
  })

  it('offers no welcome line when the message already says it', () => {
    const used = applySuggestion(named, northwind, 'welcome')
    expect(importSuggestions(northwind, used, used).map((s) => s.key)).toEqual(['name'])
  })
})
