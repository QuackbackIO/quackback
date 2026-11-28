import { describe, expect, it } from 'vitest'
import { compareWithBaseline, lowerBaseline, type Finding } from './admin-ratchet'
import { scanEnglish } from './admin-english-scan'
import { logicalClass, scanDirection } from './admin-direction-scan'

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

  it('finds a single lowercase word shown as it is, and messages built with values', () => {
    expect(
      texts(
        `const a = <>
          <p>{n} members</p>
          <Button>save</Button>
          <input placeholder="search..." />
          <span aria-label={\`\${name} avatar\`} />
        </>
        toast.error(\`Failed to save \${x}\`)`
      )
    ).toEqual([
      '"members"',
      '"save"',
      'placeholder="search..."',
      'aria-label="{…} avatar"',
      'toast.error("Failed to save {…}")',
    ])
  })

  it('still skips a key or a path in a prop, and a template made only of values', () => {
    expect(
      texts(
        `const a = <Field label="inbox.unassigned" title={\`\${a}/\${b}\`} />
         toast(\`\${message}\`)`
      )
    ).toEqual([])
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

describe('the direction scan', () => {
  const found = (source: string) => scanDirection(source, 'x.tsx').map(({ text }) => text)

  it('gives the logical form of each left/right class, with its variants', () => {
    expect(logicalClass('ml-2')).toBe('ms-2')
    expect(logicalClass('-mr-1.5')).toBe('-me-1.5')
    expect(logicalClass('sm:pl-[18px]')).toBe('sm:ps-[18px]')
    expect(logicalClass('group-hover:right-0')).toBe('group-hover:end-0')
    expect(logicalClass('[&>svg]:left-1/2')).toBe('[&>svg]:start-1/2')
    expect(logicalClass('text-right')).toBe('text-end')
    expect(logicalClass('border-l')).toBe('border-s')
    expect(logicalClass('border-r-2')).toBe('border-e-2')
    expect(logicalClass('!border-l-transparent')).toBe('!border-s-transparent')
    expect(logicalClass('rounded-tl-md')).toBe('rounded-ss-md')
    expect(logicalClass('rounded-r')).toBe('rounded-e')
    expect(logicalClass('ml-auto!')).toBe('ms-auto!')
  })

  it('leaves words and other classes alone', () => {
    for (const token of [
      'left',
      'right',
      'left-click',
      'mx-2',
      'ms-2',
      'text-left-ish',
      'ml',
      'text-left-2',
    ]) {
      expect(logicalClass(token)).toBeNull()
    }
  })

  it('finds classes in strings and templates, not in prose or comments', () => {
    expect(
      found(
        `// ml-2 in a comment
         const a = <div className={cn('flex ml-2', open && \`pr-3 \${x}\`)}>3 days left</div>`
      )
    ).toEqual(['ml-2 use ms-2', 'pr-3 use pe-3'])
  })

  it('finds direction icons that do not turn round in a right-to-left page', () => {
    expect(
      found(
        `const a = <>
          <ChevronRightIcon className="size-4" />
          <ArrowLeftIcon />
          <ChevronLeftIcon className="rtl:-scale-x-100 size-4" />
          <ChevronRightIcon className={cn('size-3', 'rtl:rotate-180')} />
          <ChevronDownIcon className="size-4" />
        </>`
      )
    ).toEqual(['<ChevronRightIcon> add rtl:-scale-x-100', '<ArrowLeftIcon> add rtl:-scale-x-100'])
  })
})
