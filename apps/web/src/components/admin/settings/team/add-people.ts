/**
 * Pure rules behind the Add people dialog: reading emails out of typed or
 * pasted text, the role and seat arithmetic, and the copy that says what
 * happens to each person. Kept apart from the component so each rule is
 * tested on its own.
 */

/** How long a team invitation works. Mirrors INVITATION_EXPIRY_MS on the server. */
export const INVITE_VALID_DAYS = 30

/** Someone already found by search: joins the team as soon as the dialog submits. */
export interface PersonChip {
  kind: 'person'
  principalId: string
  name: string
  avatarUrl: string | null
  detail: string
}

/** An address with no account behind it (yet): gets an email invitation. */
export interface EmailChip {
  kind: 'email'
  address: string
}

export type AddChip = PersonChip | EmailChip

export function chipKey(chip: AddChip): string {
  return chip.kind === 'person' ? `p:${chip.principalId}` : `e:${chip.address}`
}

const EMAIL_CHARS = `[^\\s@,;<>()"'\\[\\]]`
const FULL_EMAIL = new RegExp(`^${EMAIL_CHARS}+@${EMAIL_CHARS}+\\.${EMAIL_CHARS}{2,}$`)
const ANY_EMAIL = new RegExp(`${EMAIL_CHARS}+@${EMAIL_CHARS}+\\.${EMAIL_CHARS}{2,}`, 'g')

/** A complete address, as typed (surrounding spaces allowed). */
export function isFullEmail(text: string): boolean {
  return FULL_EMAIL.test(text.trim())
}

/**
 * Every address in pasted text, lowercased and without repeats, in the order
 * they appear. Handles lists split by commas, semicolons, spaces or new lines
 * and "Name <address>" entries copied from a mail client.
 */
export function extractEmails(text: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const match of text.match(ANY_EMAIL) ?? []) {
    const address = match.toLowerCase().replace(/\.+$/, '')
    if (!isFullEmail(address) || seen.has(address)) continue
    seen.add(address)
    out.push(address)
  }
  return out
}

/** The role picked in the dialog, as the server takes it plus its display name. */
export interface RoleChoice {
  role: 'admin' | 'member'
  roleId?: string
  label: string
}

/** "a Member", "an Admin", "an Editor": the label with its article. */
export function withArticle(label: string): string {
  return `${/^[aeiou]/i.test(label) ? 'an' : 'a'} ${label}`
}

export interface SeatCheck {
  /** Seats in use once everyone in the dialog is added. */
  needed: number
  limit: number | null
  /** More seats needed than the plan has. */
  over: boolean
  /** How many people to take out to fit the plan. */
  excess: number
}

export function checkSeats(
  usage: { used: number; limit: number | null } | null | undefined,
  adding: number
): SeatCheck | null {
  if (!usage) return null
  const needed = usage.used + adding
  const limit = usage.limit
  const excess = limit == null ? 0 : Math.max(0, needed - limit)
  return { needed, limit, over: adding > 0 && excess > 0, excess }
}

export function peopleCount(n: number): string {
  return `${n} ${n === 1 ? 'person' : 'people'}`
}

/** "Adding 3 people needs 12 seats and the plan has 10. Remove 2, or" (the billing link follows). */
export function seatOverMessage(adding: number, check: SeatCheck): string {
  return `Adding ${peopleCount(adding)} needs ${check.needed} seats and the plan has ${check.limit}. Remove ${check.excess}, or`
}

/** "Adding 3 people needs 3 seats, and 1 is free. Remove 2, or" (the billing link follows). */
export function seatRefusalMessage(needed: number, free: number): string {
  return `Adding ${peopleCount(needed)} needs ${needed} ${needed === 1 ? 'seat' : 'seats'}, and ${free} ${
    free === 1 ? 'is' : 'are'
  } free. Remove ${Math.max(1, needed - free)}, or`
}

/** "Maya", "Maya and Omar", "Maya, Omar and Tess". */
export function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? ''
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

/** What happens when the dialog submits: one sentence for who joins, one for who is invited. */
export function summarySentences(chips: AddChip[], role: RoleChoice): string[] {
  const people = chips.flatMap((c) => (c.kind === 'person' ? [c.name] : []))
  const invites = chips.flatMap((c) => (c.kind === 'email' ? [c.address] : []))
  const out: string[] = []
  if (people.length === 1) {
    out.push(
      `${people[0]} joins now as ${withArticle(role.label)} and keeps signing in the way they do today.`
    )
  } else if (people.length > 1) {
    out.push(
      `${joinNames(people)} join now as ${role.label}s and keep signing in the way they do today.`
    )
  }
  if (invites.length > 0) {
    out.push(
      `${joinNames(invites)} ${invites.length === 1 ? 'gets' : 'get'} an email invitation that works for ${INVITE_VALID_DAYS} days.`
    )
  }
  return out
}

/** "Add 2 people" when anyone joins now, "Invite 2 people" when everyone is new. */
export function primaryLabel(chips: AddChip[]): string {
  if (chips.length === 0) return 'Add people'
  const verb = chips.every((c) => c.kind === 'email') ? 'Invite' : 'Add'
  return `${verb} ${peopleCount(chips.length)}`
}

export const ADD_PEOPLE_ERROR_CODES = [
  'SEAT_LIMIT',
  'GRANT_CEILING',
  'ALREADY_MEMBER',
  'INVITE_PENDING',
  'NOT_ELIGIBLE',
  'VALIDATION_ERROR',
] as const
export type AddPeopleErrorCode = (typeof ADD_PEOPLE_ERROR_CODES)[number]

/**
 * The domain error code a thrown error carries, read from its `code` or its
 * message. For server functions that still throw their refusals (role change);
 * adding people returns refusals as values instead.
 */
export function addPeopleErrorCode(error: unknown): AddPeopleErrorCode | null {
  if (!error || typeof error !== 'object') return null
  const code = (error as { code?: unknown }).code
  if (typeof code === 'string') {
    const known = ADD_PEOPLE_ERROR_CODES.find((c) => c === code)
    if (known) return known
  }
  const message = (error as { message?: unknown }).message
  if (typeof message === 'string') {
    return ADD_PEOPLE_ERROR_CODES.find((c) => message.includes(c)) ?? null
  }
  return null
}

/** The toast after a successful add: "Maya Chen is now a Member. Their ideas, votes and comments stay with them." */
export function successMessage(
  added: Array<{ name: string }>,
  invited: Array<{ email: string }>,
  role: RoleChoice
): string {
  const parts: string[] = []
  if (added.length === 1) parts.push(`${added[0].name} is now ${withArticle(role.label)}.`)
  else if (added.length > 1) {
    parts.push(`${joinNames(added.map((a) => a.name))} are now ${role.label}s.`)
  }
  if (added.length > 0) parts.push('Their ideas, votes and comments stay with them.')
  if (invited.length === 1) parts.push(`Invitation sent to ${invited[0].email}.`)
  else if (invited.length > 1) parts.push(`Invitations sent to ${peopleCount(invited.length)}.`)
  return parts.join(' ')
}
