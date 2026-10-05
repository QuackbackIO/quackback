const capitalize = (word: string) => word.charAt(0).toLocaleUpperCase() + word.slice(1)

/** The leading letters of an email's local part: "sam+rev1" and "sam.lee2" give "Sam". */
function nameFromEmail(email: string | null | undefined): string | null {
  const local = email?.split('@')[0]?.split('+')[0] ?? ''
  const letters = /^\p{L}+/u.exec(local)?.[0] ?? ''
  return letters.length >= 2 ? capitalize(letters.toLocaleLowerCase()) : null
}

/**
 * What Home greets someone by: their first name, else a friendly name from
 * their email address, never the address itself. Null when nothing usable
 * is left, for a plain greeting.
 */
export function greetingName(
  name: string | null | undefined,
  email: string | null | undefined
): string | null {
  const first = name?.trim().split(/\s+/)[0] ?? ''
  if (first && !first.includes('@') && /\p{L}/u.test(first)) return capitalize(first)
  return nameFromEmail(first.includes('@') ? first : email)
}

/**
 * The name an account shows on its ideas and comments: the name it gave,
 * else a friendly name from its email address. Null when neither gives one,
 * so the caller can keep a name it already had.
 */
export function accountDisplayName(
  name: string | null | undefined,
  email: string | null | undefined
): string | null {
  const given = name?.trim() ?? ''
  if (given && !given.includes('@')) return given
  return nameFromEmail(given.includes('@') ? given : email)
}

/**
 * The name the portal and Messenger show for the signed-in person, the same
 * name their ideas and comments carry: the name they gave, else one from
 * their email address, else the address itself.
 */
export function shownName(
  name: string | null | undefined,
  email: string | null | undefined
): string {
  return accountDisplayName(name, email) ?? (name?.trim() || email || '')
}
