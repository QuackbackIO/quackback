import type { BrandingFontId } from './fonts'

/**
 * On-demand loader for the font titles and headings are set in, when it is
 * not the text font (font-loader.ts loads that one whole). Each family's
 * heading-only module carries its semibold and bold cuts and nothing else,
 * so a page never declares the weights it does not draw a heading in.
 *
 * Its own module, never part of the theme barrel: only the portal draws
 * headings in a font of their own, so only its layout imports this (through
 * useHeadingFont), and the widget and sign-in pages never carry it.
 */
export function loadHeadingFont(id: BrandingFontId | string | null | undefined): Promise<unknown> {
  switch (id) {
    case 'roboto':
      return import('@/styles/fonts/headings/roboto.css')
    case 'open-sans':
      return import('@/styles/fonts/headings/open-sans.css')
    case 'lato':
      return import('@/styles/fonts/headings/lato.css')
    case 'nunito':
      return import('@/styles/fonts/headings/nunito.css')
    case 'poppins':
      return import('@/styles/fonts/headings/poppins.css')
    case 'dm-sans':
      return import('@/styles/fonts/headings/dm-sans.css')
    case 'jakarta':
      return import('@/styles/fonts/headings/plus-jakarta-sans.css')
    case 'geist':
      return import('@/styles/fonts/headings/geist-sans.css')
    case 'manrope':
      return import('@/styles/fonts/headings/manrope.css')
    case 'space-grotesk':
      return import('@/styles/fonts/headings/space-grotesk.css')
    case 'playfair':
      return import('@/styles/fonts/headings/playfair-display.css')
    case 'merriweather':
      return import('@/styles/fonts/headings/merriweather.css')
    case 'lora':
      return import('@/styles/fonts/headings/lora.css')
    case 'fira-code':
      return import('@/styles/fonts/headings/fira-code.css')
    case 'jetbrains':
      return import('@/styles/fonts/headings/jetbrains-mono.css')
    // Inter is in globals.css, the system font has no file, and any other id is no listed font.
    default:
      return Promise.resolve()
  }
}
