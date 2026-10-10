import { describe, expect, it } from 'vitest'
import { normalizeSetupStateV2 } from '../types'

const state = { version: 2, steps: { core: true, workspace: true, startingPoint: null } }

describe('setup goals', () => {
  it('drops unknown values, deduplicates and keeps goal order and primary goal in sync', () => {
    expect(
      normalizeSetupStateV2({
        ...state,
        goals: ['help_center', 'unknown', 'customer_support', 'help_center', null, 'status_page'],
        useCase: 'product_feedback',
      })
    ).toMatchObject({
      goals: ['help_center', 'customer_support', 'status_page'],
      useCase: 'help_center',
    })
  })
  it.each([1, 2])('reads a version %s single goal as a list', (version) => {
    expect(normalizeSetupStateV2({ ...state, version, useCase: 'customer_support' })).toMatchObject(
      { goals: ['customer_support'], useCase: 'customer_support' }
    )
  })
  it.each([1, 2])('reads version %s internal feedback as private feedback', (version) => {
    expect(normalizeSetupStateV2({ ...state, version, useCase: 'internal' })).toMatchObject({
      goals: ['product_feedback'],
      useCase: 'product_feedback',
      feedbackPrivate: true,
    })
  })
  it('falls back to the legacy goal for an invalid or empty list', () => {
    for (const goals of [null, 'customer_support', [], ['unknown']]) {
      expect(normalizeSetupStateV2({ ...state, goals, useCase: 'help_center' })).toMatchObject({
        goals: ['help_center'],
        useCase: 'help_center',
      })
    }
  })
  it('does not invent a goal for an unknown legacy value', () => {
    const normalized = normalizeSetupStateV2({
      ...state,
      goals: ['unknown'],
      useCase: 'unknown',
      feedbackPrivate: 'true',
    })
    expect(normalized?.goals).toBeUndefined()
    expect(normalized?.useCase).toBeUndefined()
    expect(normalized?.feedbackPrivate).toBeUndefined()
  })
  it('preserves explicit private choices and is idempotent', () => {
    for (const feedbackPrivate of [true, false]) {
      const normalized = normalizeSetupStateV2({
        ...state,
        goals: ['product_feedback'],
        feedbackPrivate,
      })
      expect(normalized?.feedbackPrivate).toBe(feedbackPrivate)
      expect(normalizeSetupStateV2(normalized)).toEqual(normalized)
    }
  })
})
