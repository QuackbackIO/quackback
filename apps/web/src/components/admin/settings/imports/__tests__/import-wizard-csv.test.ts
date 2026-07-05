import { describe, it, expect } from 'vitest'
import {
  parseCsvFile,
  autoMapFields,
  ignoredColumns,
  distinctColumnValues,
  buildRemappedCsv,
  type FieldMapping,
} from '../import-wizard-csv'

describe('parseCsvFile', () => {
  it('parses headers and rows', () => {
    const csv = 'title,content\nHello,World\n'
    const { headers, rows } = parseCsvFile(csv)
    expect(headers).toEqual(['title', 'content'])
    expect(rows).toEqual([{ title: 'Hello', content: 'World' }])
  })
})

describe('autoMapFields', () => {
  it('maps exact canonical headers directly', () => {
    const mapping = autoMapFields([
      'title',
      'content',
      'status',
      'tags',
      'board',
      'author_name',
      'author_email',
      'vote_count',
      'created_at',
    ])
    expect(mapping.title).toBe('title')
    expect(mapping.content).toBe('content')
    expect(mapping.status).toBe('status')
    expect(mapping.board).toBe('board')
  })

  it('maps via synonyms when the exact name is absent', () => {
    const mapping = autoMapFields(['Idea Title', 'Idea Description', 'Category Name'])
    expect(mapping.title).toBe('Idea Title')
    expect(mapping.content).toBe('Idea Description')
    expect(mapping.board).toBe('Category Name')
  })

  it('never claims the same header for two canonical fields', () => {
    // "name" is a synonym for both title and author_name; title (earlier in
    // CANONICAL_FIELDS) must claim it first.
    const mapping = autoMapFields(['name', 'content'])
    expect(mapping.title).toBe('name')
    expect(mapping.author_name).toBeNull()
  })

  it('leaves unrecognized fields unmapped', () => {
    const mapping = autoMapFields(['title', 'content', 'some_custom_column'])
    expect(mapping.vote_count).toBeNull()
    expect(mapping.source_id).toBeNull()
  })
})

describe('ignoredColumns', () => {
  it('lists headers no canonical field claimed', () => {
    const mapping = autoMapFields(['title', 'content', 'custom_field', 'another_one'])
    expect(ignoredColumns(['title', 'content', 'custom_field', 'another_one'], mapping)).toEqual([
      'custom_field',
      'another_one',
    ])
  })
})

describe('distinctColumnValues', () => {
  it('returns unique non-empty values in first-seen order', () => {
    const rows = [{ status: 'Open' }, { status: 'Closed' }, { status: 'Open' }, { status: '' }]
    expect(distinctColumnValues(rows, 'status')).toEqual(['Open', 'Closed'])
  })

  it('returns an empty array when no column is mapped', () => {
    expect(distinctColumnValues([{ status: 'Open' }], null)).toEqual([])
  })
})

describe('buildRemappedCsv', () => {
  const fieldMapping: FieldMapping = {
    title: 'idea_title',
    content: 'idea_body',
    status: 'idea_status',
    board: 'idea_board',
    tags: null,
    author_name: null,
    author_email: null,
    vote_count: null,
    created_at: null,
    source_id: null,
  }

  it('renames mapped headers onto canonical field names', () => {
    const rows = [
      { idea_title: 'Dark mode', idea_body: 'Please add it', idea_status: 'Planned', idea_board: 'Features' },
    ]
    const csv = buildRemappedCsv(rows, fieldMapping, { Planned: 'planned' }, { Features: 'features' })
    const { headers, rows: parsed } = parseCsvFile(csv)
    expect(headers).toContain('title')
    expect(headers).toContain('status')
    expect(parsed[0]).toMatchObject({
      title: 'Dark mode',
      content: 'Please add it',
      status: 'planned',
      board: 'features',
    })
  })

  it('rewrites status/board cells to the resolved target slug', () => {
    const rows = [{ idea_title: 'A', idea_body: 'B', idea_status: 'In Review', idea_board: 'Bugs' }]
    const csv = buildRemappedCsv(
      rows,
      fieldMapping,
      { 'In Review': 'under-review' },
      { Bugs: 'bugs' }
    )
    const { rows: parsed } = parseCsvFile(csv)
    expect(parsed[0].status).toBe('under-review')
    expect(parsed[0].board).toBe('bugs')
  })

  it('leaves status/board empty when the value has no mapping yet', () => {
    const rows = [{ idea_title: 'A', idea_body: 'B', idea_status: 'Unmapped', idea_board: '' }]
    const csv = buildRemappedCsv(rows, fieldMapping, {}, {})
    const { rows: parsed } = parseCsvFile(csv)
    expect(parsed[0].status).toBe('')
    expect(parsed[0].board).toBe('')
  })

  it('leaves unmapped canonical fields as empty columns', () => {
    const rows = [{ idea_title: 'A', idea_body: 'B', idea_status: '', idea_board: '' }]
    const csv = buildRemappedCsv(rows, fieldMapping, {}, {})
    const { rows: parsed } = parseCsvFile(csv)
    expect(parsed[0].tags).toBe('')
    expect(parsed[0].author_email).toBe('')
  })
})
