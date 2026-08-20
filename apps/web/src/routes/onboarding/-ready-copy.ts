const PLACEHOLDER_NAME = /^untitled workspace$/i

/** A name we can show on the ready screen without putting it in a sentence. */
export function displayWorkspaceName(name: string | null | undefined): string | null {
  const trimmed = name?.trim() ?? ''
  if (!trimmed || PLACEHOLDER_NAME.test(trimmed)) return null
  return trimmed
}
