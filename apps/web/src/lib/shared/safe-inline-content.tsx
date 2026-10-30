/** Keep legacy/generated CSS inert inside an HTML style element. */
export function escapeInlineStyle(css: string): string {
  return css.replaceAll('<', '\\3C ')
}

/** JSON text embedded in a script element must not contain HTML delimiters. */
export function serializeJsonForHtml(value: unknown): string {
  return JSON.stringify(value)
    .replaceAll('<', '\\u003c')
    .replaceAll('>', '\\u003e')
    .replaceAll('&', '\\u0026')
}

interface PortalDesignStyleProps {
  /** The workspace theme as CSS. */
  themeStyles: string
  /** The workspace's own CSS. It comes after the theme so it can override it. */
  customCss: string
}

/**
 * A workspace's theme and custom CSS, for every page that carries its brand.
 * It lives beside escapeInlineStyle, in the module those pages already share,
 * so the bundler does not split it into a chunk every portal page requests.
 */
export function PortalDesignStyle({ themeStyles, customCss }: PortalDesignStyleProps) {
  return (
    <>
      {themeStyles && (
        <style dangerouslySetInnerHTML={{ __html: escapeInlineStyle(themeStyles) }} />
      )}
      {customCss && <style dangerouslySetInnerHTML={{ __html: escapeInlineStyle(customCss) }} />}
    </>
  )
}
