import { describe, expect, it } from 'vitest'
import { cloudMembershipActions } from '../workspace-ownership'

describe('cloudMembershipActions', () => {
  it('hides transfer and leave when cloud is off', () => {
    expect(
      cloudMembershipActions({
        billingEnabled: false,
        ownerEmail: 'owner@example.com',
        currentEmail: 'owner@example.com',
      })
    ).toEqual({ showTransfer: false, showLeave: false, isOwner: false })
    expect(
      cloudMembershipActions({
        billingEnabled: false,
        ownerEmail: 'owner@example.com',
        currentEmail: 'mate@example.com',
      })
    ).toEqual({ showTransfer: false, showLeave: false, isOwner: false })
  })

  it('lets the owner transfer and refuses leave', () => {
    expect(
      cloudMembershipActions({
        billingEnabled: true,
        ownerEmail: 'Owner@Example.com',
        currentEmail: 'owner@example.com',
      })
    ).toEqual({ showTransfer: true, showLeave: false, isOwner: true })
  })

  it('lets a non-owner leave and hides transfer', () => {
    expect(
      cloudMembershipActions({
        billingEnabled: true,
        ownerEmail: 'owner@example.com',
        currentEmail: 'mate@example.com',
      })
    ).toEqual({ showTransfer: false, showLeave: true, isOwner: false })
  })
})
