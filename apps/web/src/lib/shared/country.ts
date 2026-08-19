/**
 * ISO-3166-1 alpha-2 country code formatting shared by any surface that
 * renders a raw country code (analytics breakdowns, the people directory).
 */

const regionNames = new Intl.DisplayNames(['en'], { type: 'region' })

/** Full English country name for an ISO-3166-1 alpha-2 code, falling back to the code itself. */
export function countryName(code: string): string {
  try {
    return regionNames.of(code.toUpperCase()) ?? code
  } catch {
    return code
  }
}

/** ISO-3166-1 alpha-2 code to its flag emoji (regional indicator pair). */
export function countryFlag(code: string): string {
  return String.fromCodePoint(...[...code.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65))
}
