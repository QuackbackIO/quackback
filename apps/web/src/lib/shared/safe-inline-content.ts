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
