import { describe, it, expect } from 'vitest'
// The source of truth comes through the server db barrel (apps/web may not import
// @quackback/db directly). It drags postgres, which is fine in this node test.
import {
  PERMISSIONS as DB_PERMISSIONS,
  ALL_PERMISSIONS as DB_ALL_PERMISSIONS,
  PERMISSION_CATEGORIES as DB_PERMISSION_CATEGORIES,
} from '@/lib/server/db'
import * as mirror from '../permissions'

// The client mirror (apps/web/.../permissions.ts) duplicates the @quackback/db
// catalogue because client bundles can't import the db package. This guards the
// two from drifting: edit the db catalogue first, then mirror the change here.
describe('permission catalogue mirror', () => {
  it('PERMISSIONS is identical to the source of truth', () => {
    expect(mirror.PERMISSIONS).toEqual(DB_PERMISSIONS)
  })

  it('ALL_PERMISSIONS matches', () => {
    expect(new Set(mirror.ALL_PERMISSIONS)).toEqual(new Set(DB_ALL_PERMISSIONS))
    expect(mirror.ALL_PERMISSIONS.length).toBe(DB_ALL_PERMISSIONS.length)
  })

  it('PERMISSION_CATEGORIES matches', () => {
    expect(new Set(mirror.PERMISSION_CATEGORIES)).toEqual(new Set(DB_PERMISSION_CATEGORIES))
  })
})
