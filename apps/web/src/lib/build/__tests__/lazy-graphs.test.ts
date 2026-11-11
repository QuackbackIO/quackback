import { describe, expect, it } from 'vitest'
import { readLazyGraphs } from '../lazy-graphs'

const bundle = {
  'assets/entry.js': { type: 'chunk', fileName: 'assets/entry.js', facadeModuleId: '/src/client.tsx' },
  'assets/home-abc.js': { type: 'chunk', fileName: 'assets/home-abc.js', facadeModuleId: '/src/home.tsx' },
  'assets/ui.js': { type: 'chunk', fileName: 'assets/ui.js', facadeModuleId: null },
  'assets/globals.css': { type: 'asset' },
}

describe('readLazyGraphs', () => {
  it("names each page's chunk by its module", () => {
    expect(readLazyGraphs(bundle, { home: '/src/home.tsx' })).toEqual({ home: '/assets/home-abc.js' })
  })

  it('has nothing for a page the build did not split out', () => {
    expect(readLazyGraphs(bundle, { feed: '/src/feed.tsx' })).toEqual({})
  })
})
