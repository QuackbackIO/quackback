/**
 * One spelling of "a subject line" for every outgoing email.
 *
 * A subject is a single header line. Some subjects are built from text a person
 * typed (a conversation's subject is its first message), so they can carry line
 * breaks, tabs or other control characters. Providers treat those differently:
 * Amazon SES rejects the whole message as an invalid subject, and others fold or
 * mangle the header. Cleaning here, at the send path, means no template can
 * hand a provider a subject that is not one line.
 */

/**
 * The longest subject sent, in characters. Comfortably above what the app
 * builds (a 300-character ticket title plus its prefix) and well under the
 * 998-character line limit in RFC 5322, so only runaway input is ever cut.
 */
export const MAX_SUBJECT_LENGTH = 500

/** C0 and C1 control characters, DEL, and the Unicode line and paragraph separators. */
const CONTROL_CHARACTERS = /[\p{Cc}\u2028\u2029]/gu

/** `subject` as one clean line: no control characters, single spaces, trimmed, capped. */
export function singleLineSubject(subject: string): string {
  const line = subject.replace(CONTROL_CHARACTERS, ' ').replace(/\s+/g, ' ').trim()
  const characters = Array.from(line)
  if (characters.length <= MAX_SUBJECT_LENGTH) return line
  return `${characters
    .slice(0, MAX_SUBJECT_LENGTH - 3)
    .join('')
    .trimEnd()}...`
}
