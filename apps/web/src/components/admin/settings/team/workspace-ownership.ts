export function cloudMembershipActions(input: {
  billingEnabled: boolean
  ownerEmail: string | null | undefined
  currentEmail: string | null | undefined
}): { showTransfer: boolean; showLeave: boolean; isOwner: boolean } {
  if (!input.billingEnabled) {
    return { showTransfer: false, showLeave: false, isOwner: false }
  }
  const owner = input.ownerEmail?.trim().toLowerCase() ?? ''
  const me = input.currentEmail?.trim().toLowerCase() ?? ''
  if (!owner || !me) {
    return { showTransfer: false, showLeave: false, isOwner: false }
  }
  const isOwner = owner === me
  return { showTransfer: isOwner, showLeave: !isOwner, isOwner }
}
