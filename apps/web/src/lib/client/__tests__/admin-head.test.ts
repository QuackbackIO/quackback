import { describe, expect, it } from 'vitest'
import { adminPageHead } from '../admin-head'

const rootWith = (name?: string) => ({
  routeId: '__root__',
  context: { settings: name === undefined ? null : { name } },
})

describe('adminPageHead', () => {
  it('titles the page with its section and the workspace name', () => {
    const head = adminPageHead('Feedback')({ matches: [rootWith('Fernhill')] })
    expect(head.meta).toEqual([{ title: 'Feedback · Fernhill' }])
  })

  it('falls back to the section alone before the workspace is known', () => {
    const head = adminPageHead('Settings')({ matches: [rootWith()] })
    expect(head.meta).toEqual([{ title: 'Settings' }])
  })

  it('ignores a blank workspace name and a missing root match', () => {
    expect(adminPageHead('Users')({ matches: [rootWith('  ')] }).meta).toEqual([{ title: 'Users' }])
    expect(adminPageHead('Users')({ matches: [] }).meta).toEqual([{ title: 'Users' }])
  })
})
