/**
 * The chosen design as portal pages need it. Legacy pages keep reading the
 * branding settings; a v2 page reads its mode, CSS and font from here.
 */
import { generateWorkspaceThemeCSS, readFontSans } from '@/lib/shared/theme'
import type { ThemeConfig, ThemeMode } from '@/lib/shared/theme/types'

export type PortalDesignView =
  | { engine: 'legacy' }
  | {
      engine: 'v2'
      mode: 'auto' | 'light' | 'dark'
      /** The published revision number, or null for a design converted on read. */
      revision: number | null
      /** The design's tokens, scoped to `[data-portal-theme]`. */
      themeStyles: string
      /** The design's own CSS, in the `tenant` layer. */
      customCss: string
      /** The body font stack, for the font loader. */
      fontSans: string
      /** The structural choices, set on `<html>` as `data-qb-*` attributes. */
      attributes: Record<`data-qb-${string}`, string>
    }

/** The settings a portal page reads its theme from. */
interface ThemeSettings {
  brandingConfig?: ThemeConfig | null
  customCss?: string | null
  portalDesign?: PortalDesignView
}

export interface PortalTheme {
  /** 'user' lets the visitor choose; 'light' or 'dark' forces it. */
  themeMode: ThemeMode
  themeStyles: string
  customCss: string
  configFontSans: string | null
}

export function portalThemeMode(settings: ThemeSettings | null | undefined): ThemeMode {
  const view = settings?.portalDesign
  if (view?.engine === 'v2') return view.mode === 'auto' ? 'user' : view.mode
  return settings?.brandingConfig?.themeMode ?? 'user'
}

/** What a portal page injects: the theme, the workspace's CSS and the font to load. */
export function portalTheme(settings: ThemeSettings | null | undefined): PortalTheme {
  const view = settings?.portalDesign
  const themeMode = portalThemeMode(settings)
  if (view?.engine === 'v2') {
    return {
      themeMode,
      themeStyles: view.themeStyles,
      customCss: view.customCss,
      configFontSans: view.fontSans,
    }
  }
  const brandingConfig = settings?.brandingConfig ?? {}
  return {
    themeMode,
    themeStyles: generateWorkspaceThemeCSS(brandingConfig),
    customCss: settings?.customCss ?? '',
    configFontSans: readFontSans(brandingConfig.light),
  }
}
