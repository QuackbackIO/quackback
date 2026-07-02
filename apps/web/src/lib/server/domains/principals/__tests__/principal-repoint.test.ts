import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createId } from '@quackback/ids'
import {
  operations,
  mockTx,
  mockUpdateSet,
  opsFor,
  resetDbMockState,
} from '@/lib/server/__tests__/principal-merge-db-mock'

vi.mock('@/lib/server/db', async () =>
  (await import('@/lib/server/__tests__/principal-merge-db-mock')).mockDbModule()
)

import { REPOINT_STEPS, repointPrincipalActivity } from '../principal-repoint'
import { isNull, eq } from '@/lib/server/db'

const FROM = createId('principal')
const TO = createId('principal')

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const tx = mockTx as any

describe('REPOINT_STEPS registry', () => {
  beforeEach(() => {
    resetDbMockState()
  })

  it('every step declares a table, columns, and a reason', () => {
    for (const step of REPOINT_STEPS) {
      expect(step.table).toBeTruthy()
      expect(step.columns.length).toBeGreaterThan(0)
      expect(step.description).toBeTruthy()
    }
  })

  it('orders the in-app notification fixup before the comment re-point', () => {
    // The notification step finds the anon user's comments by principal_id;
    // once post_comments is re-pointed those rows are no longer addressable.
    const notifIdx = REPOINT_STEPS.findIndex((s) => s.table === 'in_app_notifications')
    const commentIdx = REPOINT_STEPS.findIndex((s) => s.table === 'post_comments')
    expect(notifIdx).toBeGreaterThanOrEqual(0)
    expect(commentIdx).toBeGreaterThanOrEqual(0)
    expect(notifIdx).toBeLessThan(commentIdx)
  })

  it('re-points every registered activity table', async () => {
    await repointPrincipalActivity(tx, FROM, TO)

    for (const table of [
      'post_votes',
      'post_comment_reactions',
      'post_comments',
      'posts',
      'post_edit_history',
      'post_comment_edit_history',
      'post_activity',
      'conversations',
      'conversation_messages',
      'post_subscriptions',
      'in_app_notifications',
      'page_views',
      'visitor_devices',
      'user_segments',
      'kb_article_feedback',
    ]) {
      expect(operations, `expected an update for ${table}`).toContain(`update:${table}`)
    }
  })

  it.each([
    ['post_votes'],
    ['post_comment_reactions'],
    ['post_subscriptions'],
    ['kb_article_feedback'],
  ])('deletes colliding anon rows in %s before re-pointing', async (table) => {
    await repointPrincipalActivity(tx, FROM, TO)

    const ops = opsFor(table)
    expect(ops[0]).toBe(`delete:${table}`)
    expect(ops).toContain(`update:${table}`)
    expect(ops.indexOf(`delete:${table}`)).toBeLessThan(ops.indexOf(`update:${table}`))
  })

  it('transfers explicit segment memberships and drops dynamic leftovers', async () => {
    await repointPrincipalActivity(tx, FROM, TO)

    // collision delete, explicit-row transfer, then dynamic-leftover delete
    expect(opsFor('user_segments')).toEqual([
      'delete:user_segments',
      'update:user_segments',
      'delete:user_segments',
    ])
    // The transfer excludes rows the evaluator will rebuild on its own.
    const { ne } = await import('@/lib/server/db')
    expect(ne).toHaveBeenCalledWith('userSegments.addedBy', 'dynamic')
  })

  describe('in-app notification fixup', () => {
    // The self-notification delete and title rewrite match the anon user's
    // comments via a correlated EXISTS on post_comments, so both fixups are
    // single statements with no id round-trip.
    it('drops self-notifications and rewrites titles when display names are provided', async () => {
      await repointPrincipalActivity(tx, FROM, TO, {
        displayNames: { from: 'Curious Penguin', to: 'Jane Doe' },
      })

      // self-notification delete, title fixup, then the re-point
      expect(opsFor('in_app_notifications')).toEqual([
        'delete:in_app_notifications',
        'update:in_app_notifications',
        'update:in_app_notifications',
      ])
    })

    it('skips the title rewrite when no display names are provided', async () => {
      await repointPrincipalActivity(tx, FROM, TO)

      // self-notification delete + re-point only
      expect(opsFor('in_app_notifications')).toEqual([
        'delete:in_app_notifications',
        'update:in_app_notifications',
      ])
    })
  })

  describe('contact_email consolidation (user wins, lead fills gaps)', () => {
    it('fills the target from the source via one conditional UPDATE', async () => {
      await repointPrincipalActivity(tx, FROM, TO)

      expect(opsFor('principal')).toEqual(['update:principal'])
      // The SET pulls the source email with a correlated subquery.
      expect(mockUpdateSet).toHaveBeenCalledWith({
        contactEmail: expect.objectContaining({ _type: 'sql' }),
      })
      expect(eq).toHaveBeenCalledWith('principal.id', TO)
    })

    it('never overwrites a set target contact_email (guarded by IS NULL in the WHERE)', async () => {
      await repointPrincipalActivity(tx, FROM, TO)

      // Fill-if-empty is enforced in the WHERE: a populated target matches
      // zero rows, and a source without an email writes NULL over NULL.
      expect(isNull).toHaveBeenCalledWith('principal.contactEmail')
    })
  })
})
