/**
 * Widget `open({ articleId })` should show the requested locale when a
 * translation exists, and the default-locale article otherwise — same
 * fallback as help search. Portal `/hc/{locale}/…` URLs stay strict 404.
 */
export async function withDefaultLocaleFallback<T>(
  locale: string,
  defaultLocale: string,
  load: (locale: string) => Promise<T>,
  isMissing: (err: unknown) => boolean
): Promise<{ value: T; locale: string }> {
  try {
    return { value: await load(locale), locale }
  } catch (err) {
    if (isMissing(err) && locale !== defaultLocale) {
      return { value: await load(defaultLocale), locale: defaultLocale }
    }
    throw err
  }
}
