import { describe, expect, it } from 'vitest'
import { inScope, offends, usedRegistryPaths, type FileRuleName } from './admin-consistency.rules'

const SETTINGS_FILE = 'components/admin/settings/example.tsx'
const ROUTE_FILE = 'routes/admin/settings.example.tsx'

/** Snippets that start with a tag are wrapped into a program the parser accepts. */
const program = (src: string) =>
  src.trimStart().startsWith('<') ? `export const A = () => <>${src}</>` : src

describe('comments', () => {
  it('are never read as code or text', () => {
    const src = `const a = 'https://x.test' // New Entry\n/* Add new — x */ const b = "// keep"\n`
    expect(offends('create-labels', SETTINGS_FILE, src)).toBe(false)
    expect(offends('no-dashes', SETTINGS_FILE, src)).toBe(false)
  })

  it('does not end a regex literal containing a comment opener early', () => {
    const src = `const re = /\\/*x/\nconst s = 'a — b'`
    expect(offends('no-dashes', SETTINGS_FILE, src)).toBe(true)
    expect(offends('no-dashes', SETTINGS_FILE, `const re = /a\\/*b/ // —`)).toBe(false)
  })

  it('does not read // inside JSX text as a comment', () => {
    const src = `export const A = () => <p>see https://x.test then — done</p>`
    expect(offends('no-dashes', SETTINGS_FILE, src)).toBe(true)
  })
})

describe('scopes', () => {
  it('limits settings rules to settings and automation files', () => {
    expect(inScope('page-shell', 'routes/admin/settings.tags.tsx')).toBe(true)
    expect(inScope('page-shell', 'routes/admin/automation.agent.tsx')).toBe(true)
    expect(inScope('page-shell', 'components/admin/settings/tags/tags-list.tsx')).toBe(true)
    expect(inScope('page-shell', 'components/admin/automation/skills-list.tsx')).toBe(true)
    expect(inScope('page-shell', 'components/admin/feedback/inbox-container.tsx')).toBe(false)
    expect(inScope('page-shell', 'components/admin/settings/__tests__/x.test.tsx')).toBe(false)
  })

  it('applies copy rules to every admin file', () => {
    expect(inScope('create-labels', 'components/admin/feedback/inbox-container.tsx')).toBe(true)
    expect(inScope('no-dashes', 'routes/admin/index.tsx')).toBe(true)
    expect(inScope('no-dashes', 'components/shared/x.tsx')).toBe(false)
  })

  it('excepts the shell primitives and layout files', () => {
    expect(inScope('page-shell', 'components/admin/settings/settings-page.tsx')).toBe(false)
    expect(inScope('page-shell', 'routes/admin/settings.tsx')).toBe(false)
    expect(inScope('page-width', 'components/admin/settings/settings-page.tsx')).toBe(false)
  })
})

const CASES: Array<{ rule: FileRuleName; file?: string; bad: string; good: string }> = [
  {
    rule: 'page-shell',
    bad: `import { PageHeader } from '@/components/shared/page-header'\nexport const A = () => <PageHeader title="x" />`,
    good: `import { SettingsPage } from '@/components/admin/settings/settings-page'`,
  },
  {
    rule: 'page-shell',
    bad: `export const A = () => <h1 className="x">Title</h1>`,
    good: `export const A = () => <h2>Section</h2>`,
  },
  {
    rule: 'page-width',
    bad: `export const A = () => <div className="max-w-3xl space-y-6" />`,
    good: `export const A = () => <div className="max-w-md space-y-6" />`,
  },
  { rule: 'page-width', bad: `cn('max-w-5xl')`, good: `cn('max-w-xs')` },
  {
    rule: 'create-labels',
    file: ROUTE_FILE,
    bad: `<Button>Add new board</Button>`,
    good: `<Button>New board</Button>`,
  },
  {
    rule: 'create-labels',
    bad: `const label = 'Create Key'`,
    good: `const label = 'Create key'`,
  },
  { rule: 'create-labels', bad: `<Button>New Entry</Button>`, good: `<Button>New entry</Button>` },
  {
    rule: 'create-labels',
    bad: `// fine in a comment\nconst x = "Add Member"`,
    good: `// Add Member in a comment is ignored\nconst x = "Add member"`,
  },
  { rule: 'no-dashes', bad: `<p>One — two</p>`, good: `<p>One, two</p>` },
  {
    rule: 'no-dashes',
    bad: `<p>{count} items — all synced</p>`,
    good: `<p>{count} items, all synced</p>`,
  },
  {
    rule: 'create-labels',
    bad: `<Button>{icon} New Entry</Button>`,
    good: `<Button>{icon} New entry</Button>`,
  },
  {
    rule: 'page-width',
    bad: `export const A = () => <div className={cn('space-y-6', wide && 'max-w-5xl')} />`,
    good: `export const A = () => <DialogContent className="sm:max-w-2xl">x</DialogContent>`,
  },
  {
    rule: 'page-width',
    bad: `export const A = () => <section className="max-w-4xl"><DialogTrigger /></section>`,
    good: `export const A = () => <SheetContent><div className="mx-auto max-w-3xl">x</div></SheetContent>`,
  },
  {
    rule: 'page-width',
    bad: `export const A = () => <div className={\`mx-auto max-w-6xl \${gap}\`} />`,
    good: `export const A = () => <PopoverContent className="max-w-2xl">x</PopoverContent>`,
  },
  {
    rule: 'page-width',
    bad: `export const A = () => <div className="max-w-3xl">x</div>`,
    good: `export const A = () => <TooltipContent className="max-w-4xl">x</TooltipContent>`,
  },
  {
    rule: 'tab-icons',
    bad: `<TabsTrigger value="a">{tab.icon && <tab.icon className="h-4" />}General</TabsTrigger>`,
    good: `<TabsTrigger value="a">{tab.label}</TabsTrigger>`,
  },
  {
    rule: 'tab-icons',
    bad: `<TabsTrigger value="a"><Icon />General</TabsTrigger>`,
    good: `<TabsTrigger value="a">General</TabsTrigger><Icon />`,
  },
  {
    rule: 'tab-icons',
    bad: `<TabsTrigger value="a"><span className="icon" />General</TabsTrigger>`,
    good: `<TabsTrigger value="a">General (3)</TabsTrigger>`,
  },
  { rule: 'no-dashes', bad: `const s = 'a – b'`, good: `const s = 'a, b'` },
  {
    rule: 'no-dashes',
    bad: `const s = \`a — b\``,
    good: `// a — b in a comment\nconst s = 'a'`,
  },
  {
    rule: 'tab-icons',
    bad: `<TabsTrigger value="a"><CogIcon className="h-4" />General</TabsTrigger>`,
    good: `<TabsTrigger value="a">General</TabsTrigger>`,
  },
  {
    rule: 'tab-icons',
    bad: `<TabsTrigger value="a">\n  <Squares2X2Icon />\n  Boards\n</TabsTrigger>`,
    good: `<TabsTrigger value="a">Boards</TabsTrigger>\n<CogIcon />`,
  },
  {
    rule: 'toggle-rows',
    bad: `<Switch checked={on} onCheckedChange={setOn} />`,
    good: `<SettingRow label="On" control={<Switch checked={on} />} />`,
  },
  {
    rule: 'palette',
    bad: `<span className="text-green-500" />`,
    good: `<span className="text-success" />`,
  },
  { rule: 'palette', bad: `cn('bg-amber-100 dark:bg-amber-900')`, good: `cn('bg-warning/10')` },
  { rule: 'palette', bad: `const c = 'border-rose-300'`, good: `const c = 'border-destructive'` },
]

describe('matchers', () => {
  it.each(CASES)('$rule flags an offending source and accepts a compliant one (%#)', (c) => {
    const file = c.file ?? SETTINGS_FILE
    expect(offends(c.rule, file, program(c.bad))).toBe(true)
    expect(offends(c.rule, file, program(c.good))).toBe(false)
  })

  it('never flags a file outside the rule scope', () => {
    expect(
      offends('palette', 'components/admin/feedback/x.tsx', "const c = 'text-green-500'")
    ).toBe(false)
    expect(offends('toggle-rows', 'components/admin/feedback/x.tsx', program('<Switch />'))).toBe(
      false
    )
  })

  it('does not treat a SettingRows-only file as a setting-row file', () => {
    expect(offends('toggle-rows', SETTINGS_FILE, program('<SettingRowsX /><Switch />'))).toBe(true)
  })
})

describe('usedRegistryPaths', () => {
  it('finds page="<path>" props', () => {
    const used = usedRegistryPaths([
      { file: 'a.tsx', src: `export const A = () => <SettingsPage page="/admin/settings/tags" />` },
      {
        file: 'b.tsx',
        src: `export const B = () => <SettingsPage page='/admin/settings/agent' />`,
      },
      { file: 'c.tsx', src: `// <SettingsPage page="/admin/settings/boards" />` },
    ])
    expect([...used].sort()).toEqual(['/admin/settings/agent', '/admin/settings/tags'])
  })
})
