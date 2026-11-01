/**
 * Theme values are written into declarations such as `--primary: <value>;`.
 * A safe value cannot end that declaration, open or close a block, start a
 * comment or an at-rule, escape a character, close the style element or load
 * a resource. Colours, font stacks and radii never need any of those.
 */
const UNSAFE_THEME_VALUE = /[;{}<>\\@]|\/\*|\*\/|url\s*\(/i

/** Long enough for any font stack the editor offers. */
export const THEME_VALUE_MAX_LENGTH = 300

function hasControlCharacter(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i)
    if (code < 0x20 || code === 0x7f) return true
  }
  return false
}

export function isSafeThemeValue(value: string): boolean {
  return (
    value.length <= THEME_VALUE_MAX_LENGTH &&
    !UNSAFE_THEME_VALUE.test(value) &&
    !hasControlCharacter(value)
  )
}

/** The theme variables with every unsafe string value removed. */
export function withoutUnsafeThemeValues<T extends object>(vars: T | undefined): T | undefined {
  if (!vars) return vars
  const entries = Object.entries(vars).filter(
    ([, value]) => typeof value !== 'string' || isSafeThemeValue(value)
  )
  return Object.fromEntries(entries) as T
}
