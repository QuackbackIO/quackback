/**
 * Substitute supported placeholders in an admin-authored chat message (e.g. the
 * welcome greeting). Shared by the widget render and tests; pure, no React.
 *
 * Today only {{first_name}} is supported. An anonymous/unknown visitor falls
 * back to `fallbackName` ("there" by default) so the greeting still reads
 * naturally — matching the widget's existing "Hi there 👋" anonymous copy.
 */
const FIRST_NAME_TOKEN = /\{\{\s*first_name\s*\}\}/g

export function personalizeMessage(
  template: string,
  firstName: string | null | undefined,
  fallbackName = 'there'
): string {
  const name = firstName?.trim() || fallbackName
  return template.replace(FIRST_NAME_TOKEN, name)
}

/** First name from a full name ("Jane Doe" → "Jane"), or undefined if blank. */
export function firstNameOf(name: string | null | undefined): string | undefined {
  return name?.trim().split(/\s+/)[0] || undefined
}
