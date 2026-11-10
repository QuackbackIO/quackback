/**
 * What a block can point at: public roadmaps, help topics, and boards a
 * signed-out visitor can see. A block on the portal never offers a private one.
 */
import { describe, expect, it } from 'vitest'
import { blockSources, shippedStatusIds } from '../use-block-sources'

describe('blockSources', () => {
  it('offers public roadmaps, help topics and boards visitors can see, by id and name', () => {
    const sources = blockSources({
      roadmaps: [
        { id: 'r1', name: 'Product', visibility: 'public' },
        { id: 'r2', name: 'Internal', visibility: 'private' },
      ],
      boards: [
        { id: 'b1', name: 'Mobile', access: { view: 'anonymous' } },
        { id: 'b2', name: 'Team only', access: { view: 'team' } },
      ],
      categories: [{ id: 'c1', name: 'Getting started' }],
    })
    expect(sources).toEqual({
      roadmaps: [['r1', 'Product']],
      boards: [['b1', 'Mobile']],
      categories: [['c1', 'Getting started']],
      columns: [],
      statuses: [],
    })
  })

  it('offers nothing while the lists load', () => {
    expect(blockSources({})).toEqual({
      roadmaps: [],
      boards: [],
      categories: [],
      columns: [],
      statuses: [],
    })
  })

  it('offers every status, and knows the shipped ones by their Complete category', () => {
    const statuses = [
      { id: 's1', name: 'Planned', category: 'active' },
      { id: 's2', name: 'Complete', category: 'complete' },
      { id: 's3', name: 'Closed', category: 'closed' },
    ]
    expect(blockSources({ statuses }).statuses).toEqual([
      ['s1', 'Planned'],
      ['s2', 'Complete'],
      ['s3', 'Closed'],
    ])
    expect(shippedStatusIds(statuses)).toEqual(['s2'])
    expect(shippedStatusIds(undefined)).toEqual([])
  })

  it('offers top-level help topics only, as a sub-topic is never drawn on its own', () => {
    const sources = blockSources({
      categories: [
        { id: 'c1', name: 'Getting started', parentId: null },
        { id: 'c2', name: 'Inside it', parentId: 'c1' },
      ],
    })
    expect(sources.categories).toEqual([['c1', 'Getting started']])
  })

  it('offers the columns of the roadmap the block shows, by status, its own or the first public', () => {
    const roadmaps = [
      {
        id: 'r0',
        name: 'Private',
        visibility: 'private',
        columns: [{ name: 'Hidden', statusId: 's0' }],
      },
      {
        id: 'r1',
        name: 'Product',
        visibility: 'public',
        columns: [
          { name: 'Planned', statusId: 's1' },
          { name: 'Ideas', statusId: null },
        ],
      },
      {
        id: 'r2',
        name: 'Later',
        visibility: 'public',
        columns: [{ name: 'Someday', statusId: 's2' }],
      },
    ]
    expect(blockSources({ roadmaps }).columns).toEqual([['s1', 'Planned']])
    expect(blockSources({ roadmaps, roadmapId: 'r2' }).columns).toEqual([['s2', 'Someday']])
  })
})
