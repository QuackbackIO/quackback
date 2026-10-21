/**
 * The issue each ticket status gives by default, from its category and
 * requester-facing stage; a destination's own mapping over it, or null to
 * leave the issue alone; and the status labels Quackback owns.
 */
import { describe, it, expect } from 'vitest'
import {
  defaultIssuePushState,
  issuePushStateFor,
  ownedStatusLabels,
  priorityLabel,
  type IssuePushStatus,
} from '../issue-push'

const status = (
  id: string,
  category: IssuePushStatus['category'],
  publicStage: IssuePushStatus['publicStage']
): IssuePushStatus => ({ id, category, publicStage })

// The seeded statuses.
const NEW = status('new', 'open', 'received')
const ESCALATED = status('escalated', 'open', 'in_progress')
const WAITING_CUSTOMER = status('waiting_customer', 'pending', 'awaiting_requester')
const WAITING_THIRD = status('waiting_third_party', 'pending', 'in_progress')
const RESOLVED = status('resolved', 'closed', 'resolved')
const WONT_DO = status('wont_do', 'closed', null)

describe('defaultIssuePushState', () => {
  it('derives the issue from the category and stage', () => {
    expect(defaultIssuePushState(NEW)).toEqual({ state: 'open' })
    expect(defaultIssuePushState(ESCALATED)).toEqual({ state: 'open' })
    expect(defaultIssuePushState(WAITING_CUSTOMER)).toEqual({
      state: 'open',
      label: 'waiting-on-customer',
    })
    expect(defaultIssuePushState(WAITING_THIRD)).toEqual({ state: 'open', label: 'on-hold' })
    expect(defaultIssuePushState(RESOLVED)).toEqual({ state: 'closed', stateReason: 'completed' })
    expect(defaultIssuePushState(WONT_DO)).toEqual({ state: 'closed', stateReason: 'not_planned' })
  })
})

describe('issuePushStateFor', () => {
  it('prefers the mapping, falls back to the default, and null leaves the issue alone', () => {
    const mappings = {
      resolved: { state: 'closed' as const, stateReason: 'completed' as const, label: 'shipped' },
      escalated: null,
    }
    expect(issuePushStateFor(mappings, RESOLVED)).toEqual(mappings.resolved)
    expect(issuePushStateFor(mappings, ESCALATED)).toBeNull()
    expect(issuePushStateFor(mappings, WONT_DO)).toEqual({
      state: 'closed',
      stateReason: 'not_planned',
    })
    expect(issuePushStateFor(undefined, NEW)).toEqual({ state: 'open' })
  })
})

describe('ownedStatusLabels', () => {
  it('names every status label the mappings and defaults set, once', () => {
    const all = [NEW, ESCALATED, WAITING_CUSTOMER, WAITING_THIRD, RESOLVED, WONT_DO]
    expect(ownedStatusLabels(undefined, all).sort()).toEqual(['on-hold', 'waiting-on-customer'])
    expect(
      ownedStatusLabels(
        { resolved: { state: 'closed', label: 'shipped' }, waiting_third_party: null },
        all
      ).sort()
    ).toEqual(['shipped', 'waiting-on-customer'])
  })
})

describe('priorityLabel', () => {
  it('labels a priority, and none has no label', () => {
    expect(priorityLabel('high')).toBe('priority:high')
    expect(priorityLabel('none')).toBeNull()
  })
})
