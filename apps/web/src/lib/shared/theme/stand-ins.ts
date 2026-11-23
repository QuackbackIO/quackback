/**
 * What each side of a theme writes for a setting only the other side has,
 * so the light side's :root lines do not show through in dark mode. Shared
 * by the generator and the editor's readable CSS, apart from both so the
 * editor's summaries never load the generator.
 */
import type { ThemeVariables } from './types'
import { PAGE_HEADER } from './expand'
import { NO_HEADING_FONT } from './base'

/**
 * Both sides' variables, the side with no header colour writing the page's
 * own header when the other has one: the light side's :root lines also apply
 * in dark mode, and would otherwise show there.
 */
function withPageHeaders(
  light: ThemeVariables,
  dark: ThemeVariables
): [ThemeVariables, ThemeVariables] {
  if (!light.header && !dark.header) return [light, dark]
  return [
    light.header ? light : { ...light, ...PAGE_HEADER },
    dark.header ? dark : { ...dark, ...PAGE_HEADER },
  ]
}

/**
 * The same for the headings font: the side with none empties the variable
 * when the other has one, so headings there are set in the text font.
 */
function withHeadingFonts(
  light: ThemeVariables,
  dark: ThemeVariables
): [ThemeVariables, ThemeVariables] {
  if (!light.fontHeading === !dark.fontHeading) return [light, dark]
  return [
    light.fontHeading ? light : { ...light, fontHeading: NO_HEADING_FONT },
    dark.fontHeading ? dark : { ...dark, fontHeading: NO_HEADING_FONT },
  ]
}

/** Both sides' variables, each standing in for what only the other sets. */
export const withStandIns = (light: ThemeVariables, dark: ThemeVariables) =>
  withHeadingFonts(...withPageHeaders(light, dark))
