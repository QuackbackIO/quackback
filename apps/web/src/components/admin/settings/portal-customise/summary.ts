/**
 * Settings > Portal's summary of what is live, row by row, read the way the
 * Customise page reads it.
 */
import { type ThemeConfig, type ThemeMode } from '@/lib/shared/theme'
import { customFontStack } from '@/lib/shared/theme/generator'
import { advancedCssRemainder } from '@/lib/shared/theme/readable-css'
import { isAutoColour } from '@/lib/shared/theme/colour-setters'
import { isEmptyTiptapDoc } from '@/lib/shared/utils/is-empty-tiptap-doc'
import { seedNavEditorItems } from '@/components/public/portal-header-nav'
import type { PortalConfig } from '@/lib/shared/types/settings'
import {
  buildInitialCss,
  fontOf,
  palettesOf,
  radiusOf,
} from '@/components/admin/settings/branding/theme-css'
import { hexOrNull } from './colours'
import { cornersName, fontName } from './font-shape-section'

export interface SummaryRow {
  label: string
  value: string
  /** A colour swatch beside the value. */
  swatch?: string
}

const MODE_NAMES: Record<ThemeMode, string> = {
  light: 'Light',
  dark: 'Dark',
  user: 'Visitor chooses',
}

export function portalSummary(live: {
  theme: ThemeConfig
  customCss: string
  portal: Partial<Pick<PortalConfig, 'nav' | 'welcomeCard'>>
  logoUrl: string | null
  headerLogo: { url: string | null; displayMode: string | null } | null
  /** Built-in tabs whose product is off. */
  gatedTypes: ReadonlySet<string>
}): SummaryRow[] {
  const themeMode = live.theme.themeMode ?? 'user'
  const cssText = buildInitialCss(live.customCss, live.theme)
  const mode = themeMode === 'dark' ? 'dark' : 'light'
  const palette = palettesOf(cssText)[mode]
  const primary = hexOrNull(palette.primary) ?? ''
  const background = hexOrNull(palette.background) ?? ''
  const backgroundAuto = isAutoColour(palette, 'background', mode)
  const buttons = live.theme.buttonShape === 'corners' ? 'matching buttons' : 'pill buttons'
  const tabs = seedNavEditorItems(live.portal.nav).filter(
    (item) =>
      item.enabled !== false &&
      !live.gatedTypes.has(item.type) &&
      (item.type !== 'link' || item.url)
  ).length
  const welcome = live.portal.welcomeCard?.body
  // What the header shows, in the words the Header and tabs section uses.
  const header =
    live.headerLogo?.displayMode === 'custom_logo' && live.headerLogo.url
      ? 'Logo'
      : live.logoUrl
        ? 'Icon and name'
        : 'Name'

  return [
    { label: 'Header', value: header },
    { label: 'Light and dark', value: MODE_NAMES[themeMode] },
    { label: 'Main colour', value: primary, swatch: primary },
    {
      label: 'Background',
      value: backgroundAuto ? 'Auto' : background,
      swatch: background,
    },
    {
      label: 'Font',
      // An uploaded family, when the theme writes it; else the font in use.
      value: customFontStack(live.theme.customFont)
        ? live.theme.customFont!.family
        : fontName(fontOf(cssText, themeMode)),
    },
    { label: 'Corners', value: `${cornersName(radiusOf(cssText, themeMode))}, ${buttons}` },
    { label: 'Navigation', value: tabs === 1 ? '1 tab' : `${tabs} tabs` },
    { label: 'Welcome message', value: welcome && !isEmptyTiptapDoc(welcome) ? 'Shown' : 'Off' },
    {
      label: 'Advanced CSS',
      value: advancedCssRemainder(live.customCss).trim() ? 'Own rules' : 'Theme only',
    },
  ]
}
