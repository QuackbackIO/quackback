/**
 * The chosen design as portal pages need it. Legacy pages keep reading the
 * branding settings; a v2 page reads its mode, CSS and font from here.
 */
import { generateWorkspaceThemeCSS, readFontSans } from '@/lib/shared/theme'
import type { ThemeConfig, ThemeMode } from '@/lib/shared/theme/types'
import type { TiptapContent } from '@/lib/shared/db-types'
import type { PortalDesign } from './schema'

/** Text a visitor reads, by locale. */
export type LocalizedText = Record<string, string>

/** A link a portal page's head carries for its design's fonts. */
export type FontLink =
  | { rel: 'preload'; href: string; as: 'font'; type: 'font/woff2'; crossOrigin: 'anonymous' }
  | { rel: 'stylesheet'; href: string }

export type PortalDesignView =
  | {
      engine: 'legacy'
      /** Kept on legacy only by its own CSS; settings carry it as `portalDesignSwitchable`. */
      switchable?: true
    }
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
      /** The bundled families to load: body, then headings. */
      fontIds: string[]
      /** Their files for the page's head, which only the server's build knows. */
      fontLinks?: FontLink[]
      /** The structural choices, set on `<html>` as `data-qb-*` attributes. */
      attributes: Record<`data-qb-${string}`, string>
      /** What the feedback page shows above the feed. */
      feedback: {
        /** The welcome message, or null when it is off or empty. */
        welcome: TiptapContent | null
        headline: PortalDesign['pages']['feedback']['headline']
        /** The feed's sort when the visitor has not picked one. */
        defaultSort: 'trending' | 'top' | 'new'
        /** The board the feed opens on when the address names none, by id; null is every board. */
        openOn?: string | null
        /** The workspace's own wording, by language. */
        copy: PortalDesign['pages']['feedback']['copy']
      }
      /** Home's headline and blocks, shown at `/` while the menu has Home on. */
      home: PortalDesign['pages']['home']
      /** The other pages' own titles; a page left out keeps its usual one. */
      titles: NonNullable<PortalDesign['pages']['titles']>
      /** The menu: Home's row, then the pages and links in order. */
      nav: PortalDesign['nav']
      /** How the header shows the brand. */
      logo: DesignLogo
      /** The logo's colours that status markers take, when the design asks for them. */
      statusColours: string[] | null
      /** The band's image and where it sits, or null. */
      bandImage: BandImage | null
      /**
       * The design's own favicon and share image, where it has them; the
       * brand icon as a favicon; the drawn share card's version; and the
       * page colour per mode for the browser's chrome.
       */
      icons?: {
        favicon: string | null
        shareImage: string | null
        mark?: string | null
        card?: string
        themeColor?: { light: string | null; dark: string | null }
      }
    }

export interface BandImage {
  url: string
  place: NonNullable<PortalDesign['layout']['imagePlace']>
  /** What it shows, for those who cannot see it; empty for decoration. */
  alt?: string
  /** Shown in Home's hero only. */
  homeOnly?: boolean
  /** Behind the words under a measured veil: the band sets its photo words (--qb-photo-ink) on it. */
  shaded?: boolean
  /** The smaller copies and the image itself by width, as an <img> srcset; absent for one file. */
  srcSet?: string
}

/**
 * The header's logo: the icon and the title, the title when not the
 * workspace's name, or a full logo image, with files for light and dark.
 */
export interface DesignLogo {
  display: PortalDesign['brand']['logo']['display']
  name: string | null
  wordmark: { light: string | null; dark: string | null }
  /** The design's own logo, in place of the workspace's, with one for dark. */
  mark?: { light: string | null; dark: string | null }
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

/**
 * The feedback page's welcome message: the design's on the design engine,
 * where it may be off, else the welcome card in the portal settings.
 */
export function savedWelcomeCard<T extends { body: unknown }>(
  design: PortalDesignView | undefined,
  legacy: T | undefined
): { body: TiptapContent } | T | undefined {
  if (design?.engine !== 'v2') return legacy
  return design.feedback.welcome ? { body: design.feedback.welcome } : undefined
}

/** The feed's sort when the visitor has not picked one: the design's, else trending. */
export function portalDefaultSort(
  settings: { portalDesign?: PortalDesignView } | null | undefined
): 'trending' | 'top' | 'new' {
  const view = settings?.portalDesign
  return view?.engine === 'v2' ? view.feedback.defaultSort : 'trending'
}

/** The links a portal page's head carries for its design's fonts. */
export function portalFontLinks(settings: ThemeSettings | null | undefined): FontLink[] {
  const view = settings?.portalDesign
  return view?.engine === 'v2' ? (view.fontLinks ?? []) : []
}

/** The bundled families a v2 design loads; legacy finds its one family from its CSS. */
export function portalFontIds(settings: ThemeSettings | null | undefined): readonly string[] {
  const view = settings?.portalDesign
  return view?.engine === 'v2' ? view.fontIds : []
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
