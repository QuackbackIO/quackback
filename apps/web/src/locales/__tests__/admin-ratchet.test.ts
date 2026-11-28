import { describe, expect, it } from 'vitest'
import { compareWithBaseline, lowerBaseline, type Finding } from './admin-ratchet'
import { scanEnglish } from './admin-english-scan'

const texts = (source: string, file = 'x.tsx') => scanEnglish(source, file).map(({ text }) => text)

describe('the English scan', () => {
  it('finds text between tags', () => {
    expect(texts('const a = <p>Assigned to me</p>')).toEqual(['"Assigned to me"'])
  })

  it('finds each prop a person reads', () => {
    expect(
      texts(
        `const a = <>
          <Input placeholder="Search conversations..." />
          <Button title={'Close panel'} aria-label="Close" />
          <Field label={\`Your name\`} description="Shown to everyone" />
        </>`
      )
    ).toEqual([
      'placeholder="Search conversations..."',
      'title="Close panel"',
      'aria-label="Close"',
      'label="Your name"',
      'description="Shown to everyone"',
    ])
  })

  it('finds toast messages and the same fields on objects', () => {
    expect(
      texts(`toast.error('Could not save the view'); const tabs = [{ label: 'General' }]`, 'x.ts')
    ).toEqual(['toast.error("Could not save the view")', 'label: "General"'])
  })

  it('gives the line of each finding', () => {
    expect(scanEnglish('const a = 1\nconst b = <p>Hello there</p>', 'x.tsx')).toEqual<Finding[]>([
      { line: 2, text: '"Hello there"' },
    ])
  })

  it("leaves the catalog's English alone", () => {
    expect(
      texts(
        `const a = <FormattedMessage id="a.b" defaultMessage="Assigned to me" description="Filter" />
         const b = intl.formatMessage({ id: 'a.c', defaultMessage: 'Unassigned' })
         const c = defineMessages({ d: { id: 'a.d', defaultMessage: 'Open', description: 'Status' } })
         const e = { id: 'a.e', defaultMessage: 'Closed', description: 'Status label' }`
      )
    ).toEqual([])
  })

  it('skips what is not words: keys, paths, classes, values and comments', () => {
    expect(
      texts(
        `// A comment with words
         const a = <div className="flex gap-2" title="/admin/inbox" aria-label={label}>{count} · 3</div>
         const b = { label: 'inbox.unassigned', title: 'https://example.com', icon: 'chevron' }
         toast(message)`
      )
    ).toEqual([])
  })

  it('reads a file that does not parse as having nothing', () => {
    expect(texts('const a = <p>Hello</', 'x.tsx')).toEqual([])
  })
})

describe('the baseline', () => {
  const findings = (count: number): Finding[] =>
    Array.from({ length: count }, (_, i) => ({ line: i + 1, text: 'x' }))

  it('lets a count stay or go down, never up, and gives a new file none', () => {
    const found = new Map([
      ['same.tsx', findings(2)],
      ['up.tsx', findings(3)],
      ['new.tsx', findings(1)],
    ])
    const { regressions, stale } = compareWithBaseline(found, {
      'same.tsx': 2,
      'up.tsx': 2,
      'down.tsx': 4,
    })
    expect(regressions.map(({ file, count, baseline }) => [file, count, baseline])).toEqual([
      ['up.tsx', 3, 2],
      ['new.tsx', 1, 0],
    ])
    expect(stale).toEqual(['down.tsx'])
  })

  it('lowers counts and drops cleared or deleted files, but never raises or adds', () => {
    expect(
      lowerBaseline(
        { 'down.tsx': 4, 'up.tsx': 2, 'cleared.tsx': 1, 'deleted.tsx': 3 },
        { 'down.tsx': 1, 'up.tsx': 5, 'new.tsx': 2 }
      )
    ).toEqual({ 'down.tsx': 1, 'up.tsx': 2 })
  })
})
