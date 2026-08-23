export type SeatUsage = {
  used: number
  limit: number | null
  members?: number
  pendingInvites?: number
  addSeatAvailable?: boolean
}

export function seatInviteBlocked(usage: SeatUsage | undefined): boolean {
  return usage != null && usage.limit != null && usage.used >= usage.limit
}

export function seatAddAvailable(usage: SeatUsage | undefined): boolean {
  return Boolean(usage?.addSeatAvailable)
}
