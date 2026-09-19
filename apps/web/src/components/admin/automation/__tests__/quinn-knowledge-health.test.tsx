/**
 * What the Knowledge page says about a source's passages.
 *
 * The rule under test is the copy rule as much as the state machine: a source
 * Quinn can read says nothing at all, and only the states a person can act on
 * are named.
 */
import { describe, it, expect } from 'vitest'
import { indexNote } from '../quinn-knowledge-sources'

describe('indexNote', () => {
  it('says nothing about a healthy source', () => {
    expect(indexNote({ status: 'indexed', serving: true, degraded: null })).toBeNull()
  })

  it('says nothing when the page has no health for a row yet', () => {
    expect(indexNote(undefined)).toBeNull()
  })

  it('names a failed refresh that is still answering from its last version', () => {
    expect(indexNote({ status: 'failed', serving: true, degraded: null })).toBe(
      'Update failed, using the last version'
    )
  })

  it('names a source that has never indexed successfully', () => {
    expect(indexNote({ status: 'failed', serving: false, degraded: null })).toBe('Not indexed')
  })

  it('names a source still waiting for its first generation', () => {
    expect(indexNote({ status: 'pending', serving: false, degraded: null })).toBe('Indexing')
  })

  it('names a generation built without embeddings', () => {
    expect(
      indexNote({ status: 'indexed', serving: true, degraded: 'embeddings_unavailable' })
    ).toBe('Keyword search only')
  })
})
