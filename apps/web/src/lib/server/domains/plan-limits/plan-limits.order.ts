/**
 * Who keeps what once a cap is enforced: the boards that stay open, the
 * members who keep a seat, the status components that stay public and the
 * sending domains that keep sending. Pure; each takes the admin's stored
 * choice (ids that no longer exist are dropped) and fills the rest from the
 * default order.
 */

export interface BoardCandidate {
  id: string
  postCount: number
  createdAt: string
  /** Set read-only by an admin, so it takes no feedback whichever board stays open. */
  readOnly?: boolean
}

export interface MemberCandidate {
  id: string
  isOwner: boolean
  canManageBilling: boolean
  /** Holds the admin team role (the legacy `admin` principal role). */
  isAdmin: boolean
  lastActiveAt: string | null
  createdAt: string
}

export interface StatusComponentCandidate {
  id: string
  /** Null for a component outside any group; those show first. */
  groupPosition: number | null
  position: number
}

export interface SendingDomainCandidate {
  id: string
  status: string
  createdAt: string
}

// ---------------------------------------------------------------------------

function keepFirst(chosen: readonly string[], ordered: readonly string[], limit: number): string[] {
  const known = new Set(ordered)
  const out: string[] = []
  for (const id of [...chosen.filter((id) => known.has(id)), ...ordered]) {
    if (out.length >= limit) break
    if (!out.includes(id)) out.push(id)
  }
  return out
}

const byId = (a: { id: string }, b: { id: string }) => a.id.localeCompare(b.id)
const byCreated = (a: { createdAt: string }, b: { createdAt: string }) =>
  Date.parse(a.createdAt) - Date.parse(b.createdAt)

/**
 * Boards that stay open: the chosen one, then boards an admin has not set
 * read-only, then most posts, then oldest.
 */
export function openBoardOrder(
  boards: readonly BoardCandidate[],
  cap: number,
  keptBoardId?: string
): string[] {
  const ordered = [...boards]
    .sort(
      (a, b) =>
        Number(!!a.readOnly) - Number(!!b.readOnly) ||
        b.postCount - a.postCount ||
        byCreated(a, b) ||
        byId(a, b)
    )
    .map((board) => board.id)
  return keepFirst(keptBoardId ? [keptBoardId] : [], ordered, cap)
}

function byRecentActivity(a: MemberCandidate, b: MemberCandidate): number {
  const aAt = a.lastActiveAt ? Date.parse(a.lastActiveAt) : -Infinity
  const bAt = b.lastActiveAt ? Date.parse(b.lastActiveAt) : -Infinity
  if (aAt !== bAt) return bAt - aAt
  return byCreated(a, b) || byId(a, b)
}

/**
 * Members who always keep a seat, so someone can always choose a plan:
 *
 * 1. the earliest owner, when there is one;
 * 2. when no one guaranteed so far can manage billing, the earliest member who
 *    can;
 * 3. when no member can manage billing at all, the earliest admin.
 *
 * Whether or not an owner exists, this always names someone who can manage
 * billing when anyone can. They count toward the cap and go past it only when
 * they alone fill it.
 */
export function guaranteedSeatHolders(members: readonly MemberCandidate[]): string[] {
  const earliest = (list: MemberCandidate[]) =>
    list.sort((a, b) => byCreated(a, b) || byId(a, b))[0]
  const guaranteed: MemberCandidate[] = []
  const owner = earliest(members.filter((m) => m.isOwner))
  if (owner) guaranteed.push(owner)
  if (!guaranteed.some((m) => m.canManageBilling)) {
    const billing = earliest(members.filter((m) => m.canManageBilling))
    if (billing) guaranteed.push(billing)
  }
  if (!members.some((m) => m.canManageBilling)) {
    const admin = earliest(members.filter((m) => m.isAdmin))
    if (admin && !guaranteed.includes(admin)) guaranteed.push(admin)
  }
  return guaranteed.map((m) => m.id)
}

/**
 * Members who keep a seat: the guaranteed ones, then the admin's choice, then
 * owners, billing managers and the most recently active, up to the cap.
 */
export function seatHolderOrder(
  members: readonly MemberCandidate[],
  cap: number,
  chosen?: readonly string[]
): string[] {
  const guaranteed = guaranteedSeatHolders(members)
  const defaults = [
    ...members.filter((m) => m.isOwner).sort((a, b) => byCreated(a, b) || byId(a, b)),
    ...members.filter((m) => m.canManageBilling).sort(byRecentActivity),
    ...members.filter((m) => !m.isOwner && !m.canManageBilling).sort(byRecentActivity),
  ].map((m) => m.id)
  return keepFirst([...guaranteed, ...(chosen ?? [])], defaults, Math.max(cap, guaranteed.length))
}

/** Status components that stay public: the chosen ones, then display order. */
export function statusComponentOrder(
  components: readonly StatusComponentCandidate[],
  cap: number,
  chosen?: readonly string[]
): string[] {
  const groupRank = (c: StatusComponentCandidate) =>
    c.groupPosition === null ? -Infinity : c.groupPosition
  const ordered = [...components]
    .sort((a, b) => {
      const ga = groupRank(a)
      const gb = groupRank(b)
      if (ga !== gb) return ga < gb ? -1 : 1
      return a.position - b.position || byId(a, b)
    })
    .map((c) => c.id)
  return keepFirst(chosen ?? [], ordered, cap)
}

/** Sending domains that keep sending: the chosen ones, then oldest verified, then oldest. */
export function sendingDomainOrder(
  domains: readonly SendingDomainCandidate[],
  cap: number,
  chosen?: readonly string[]
): string[] {
  const verified = (d: SendingDomainCandidate) => (d.status === 'verified' ? 0 : 1)
  const ordered = [...domains]
    .sort((a, b) => verified(a) - verified(b) || byCreated(a, b) || byId(a, b))
    .map((d) => d.id)
  return keepFirst(chosen ?? [], ordered, cap)
}
