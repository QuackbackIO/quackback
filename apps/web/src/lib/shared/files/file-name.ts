/**
 * Names that came from a sender (a file name, a sheet name), made to show
 * exactly the characters they are made of.
 */

/**
 * Control characters (C0, DEL, C1), format characters (bidirectional
 * embeddings, overrides, isolates and marks; zero-width spaces and joiners;
 * the byte-order mark; the soft hyphen) and line or paragraph separators.
 * None draws anything in a name, and the bidirectional ones reorder what
 * follows them: "Invoice", U+202E, "xcod.docm" displays as "Invoicemcod.docx".
 */
const INVISIBLE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu

/** The name without characters that draw nothing or reorder the rest. */
export function stripInvisible(name: string): string {
  return name.replace(INVISIBLE, '')
}
