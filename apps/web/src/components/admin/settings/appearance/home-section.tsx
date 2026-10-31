import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { SettingRow } from '@/components/admin/settings/setting-row'
import { WelcomeBodyEditor } from '@/components/admin/settings/branding/welcome-body-editor'
import { adminQueries } from '@/lib/client/queries/admin'
import type { TiptapContent } from '@/lib/shared/db-types'
import {
  newBlock,
  starterHomeBlocks,
  type HomeBlock,
  type HomeBlockType,
} from '@/lib/shared/design/home'
import { BLOCK_WIDTHS, DESIGN_OPTIONS } from '@/lib/shared/design/options'
import type { PortalPageGates } from '@/lib/shared/design/paths'
import type { PortalDesign } from '@/lib/shared/design/schema'

type Update = (change: (draft: PortalDesign) => void) => void

/**
 * The section's small icons, drawn here: an icon module this page shared with
 * others would become a chunk of its own on all of them.
 */
function Icon({ path, className }: { path: string; className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" className={className}>
      <path fillRule="evenodd" clipRule="evenodd" d={path} />
    </svg>
  )
}
const UP =
  'M8 4.5a.75.75 0 0 1 .53.22l4 4a.75.75 0 1 1-1.06 1.06L8 6.31 4.53 9.78a.75.75 0 0 1-1.06-1.06l4-4A.75.75 0 0 1 8 4.5Z'
const DOWN =
  'M8 11.5a.75.75 0 0 1-.53-.22l-4-4a.75.75 0 0 1 1.06-1.06L8 9.69l3.47-3.47a.75.75 0 1 1 1.06 1.06l-4 4a.75.75 0 0 1-.53.22Z'
const PLUS =
  'M8 2.75a.75.75 0 0 1 .75.75v3.75h3.75a.75.75 0 0 1 0 1.5H8.75v3.75a.75.75 0 0 1-1.5 0V8.75H3.5a.75.75 0 0 1 0-1.5h3.75V3.5A.75.75 0 0 1 8 2.75Z'
const CROSS =
  'M4.22 4.22a.75.75 0 0 1 1.06 0L8 6.94l2.72-2.72a.75.75 0 1 1 1.06 1.06L9.06 8l2.72 2.72a.75.75 0 1 1-1.06 1.06L8 9.06l-2.72 2.72a.75.75 0 0 1-1.06-1.06L6.94 8 4.22 5.28a.75.75 0 0 1 0-1.06Z'

/** The language the headline is written in here; other languages fall back to it. */
const HEADLINE_LOCALE = 'en'

/** Home holds at most this many blocks. */
const MAX_BLOCKS = 12

export const BLOCK_NAMES: Record<HomeBlockType, string> = {
  welcome: 'Welcome',
  composer: 'Share an idea',
  ideas: 'Top ideas',
  roadmap: 'Roadmap',
  updates: 'Latest updates',
  help_search: 'Help search',
  help_topics: 'Help topics',
  status: 'Status',
  contact: 'Contact',
  links: 'Links',
}

const WIDTH_NAMES: Record<HomeBlock['width'], string> = {
  third: 'Third',
  half: 'Half',
  two_thirds: 'Two thirds',
  full: 'Full width',
}

/** The page a block needs; it is not drawn while that page is off. */
const BLOCK_PAGE: Partial<Record<HomeBlockType, [keyof PortalPageGates, string]>> = {
  composer: ['feedback', 'Feedback'],
  ideas: ['feedback', 'Feedback'],
  roadmap: ['roadmap', 'Roadmap'],
  updates: ['changelog', 'Changelog'],
  help_search: ['help', 'Help Center'],
  help_topics: ['help', 'Help Center'],
  status: ['status', 'Status'],
  contact: ['support', 'Support'],
}

/**
 * Home in Sections: on or off, its headline, and its blocks in order, each
 * with its width and the few options it takes. Turning Home on starts it with
 * a layout built from the pages the workspace has.
 */
export function HomeSection({
  design,
  update,
  gates,
  onEdit,
}: {
  design: PortalDesign
  update: Update
  gates: PortalPageGates
  /** Called when a change is best seen on Home, so the preview can show it. */
  onEdit: () => void
}) {
  const home = design.pages.home
  const on = design.nav.home.on
  const edit: Update = (change) => {
    update(change)
    onEdit()
  }
  return (
    <section id="design-section-home" className="scroll-mt-4 space-y-4">
      <SettingRow
        label="Home page"
        description={on ? undefined : 'A page of its own at the root. The feed moves to /feedback.'}
        htmlFor="design-home"
        control={
          <Switch
            id="design-home"
            checked={on}
            onCheckedChange={(next) =>
              (next ? edit : update)((draft) => {
                draft.nav.home.on = next
                if (next && draft.pages.home.blocks.length === 0)
                  draft.pages.home.blocks = starterHomeBlocks(gates)
              })
            }
          />
        }
      />
      {on && (
        <>
          {(['title', 'subtitle'] as const).map((field) => (
            <div key={field} className="space-y-1.5">
              <label htmlFor={`design-home-${field}`} className="text-[13px] font-medium">
                {field === 'title' ? 'Home headline' : 'Home subtitle'}
              </label>
              <Input
                id={`design-home-${field}`}
                value={home.headline?.[field][HEADLINE_LOCALE] ?? ''}
                maxLength={280}
                onChange={(event) =>
                  edit((draft) => {
                    const headline = draft.pages.home.headline ?? { title: {}, subtitle: {} }
                    const text = event.target.value
                    if (text) headline[field][HEADLINE_LOCALE] = text
                    else delete headline[field][HEADLINE_LOCALE]
                    const empty =
                      Object.keys(headline.title).length + Object.keys(headline.subtitle).length ===
                      0
                    draft.pages.home.headline = empty ? null : headline
                  })
                }
              />
            </div>
          ))}
          <ol className="space-y-2" aria-label="Home blocks">
            {home.blocks.map((block, index) => (
              <BlockRow
                key={`${block.type}-${index}`}
                block={block}
                index={index}
                count={home.blocks.length}
                gates={gates}
                edit={edit}
              />
            ))}
          </ol>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button variant="outline" size="sm" disabled={home.blocks.length >= MAX_BLOCKS} />
              }
            >
              <Icon path={PLUS} className="size-4" />
              Add a block
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              {DESIGN_OPTIONS.blockType.map((type) => (
                <DropdownMenuItem
                  key={type}
                  onClick={() => edit((draft) => void draft.pages.home.blocks.push(newBlock(type)))}
                >
                  {BLOCK_NAMES[type]}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      )}
    </section>
  )
}

function BlockRow({
  block,
  index,
  count,
  gates,
  edit,
}: {
  block: HomeBlock
  index: number
  count: number
  gates: PortalPageGates
  edit: Update
}) {
  const name = BLOCK_NAMES[block.type]
  const page = BLOCK_PAGE[block.type]
  /** Changes this block in the draft. */
  const change = (apply: (draft: HomeBlock) => void) =>
    edit((draft) => apply(draft.pages.home.blocks[index]!))
  const move = (by: -1 | 1) =>
    edit((draft) => {
      const blocks = draft.pages.home.blocks
      ;[blocks[index], blocks[index + by]] = [blocks[index + by]!, blocks[index]!]
    })
  return (
    <li
      id={`design-section-block-${index}`}
      className="scroll-mt-4 space-y-3 rounded-lg border border-border p-3"
    >
      <div className="flex items-center gap-2">
        <span className="min-w-0 truncate text-[13px] font-medium">{name}</span>
        {page && !gates[page[0]] && (
          <span className="truncate text-xs text-muted-foreground">
            Hidden while {page[1]} is off
          </span>
        )}
        <div className="ms-auto flex shrink-0 items-center gap-0.5">
          {BLOCK_WIDTHS[block.type].length > 1 && (
            <Select
              value={block.width}
              onValueChange={(width) =>
                change((draft) => void (draft.width = width as HomeBlock['width']))
              }
            >
              <SelectTrigger size="sm" aria-label={`${name} width`} className="w-[120px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {BLOCK_WIDTHS[block.type].map((width) => (
                  <SelectItem key={width} value={width}>
                    {WIDTH_NAMES[width]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Move ${name} up`}
            disabled={index === 0}
            onClick={() => move(-1)}
          >
            <Icon path={UP} className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Move ${name} down`}
            disabled={index === count - 1}
            onClick={() => move(1)}
          >
            <Icon path={DOWN} className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Remove ${name}`}
            onClick={() => edit((draft) => void draft.pages.home.blocks.splice(index, 1))}
          >
            <Icon path={CROSS} className="size-4" />
          </Button>
        </div>
      </div>
      <BlockOptions block={block} change={change} />
    </li>
  )
}

/** The few options a block takes beyond its width. */
function BlockOptions({
  block,
  change,
}: {
  block: HomeBlock
  change: (apply: (draft: HomeBlock) => void) => void
}) {
  switch (block.type) {
    case 'welcome':
      return (
        <WelcomeBodyEditor
          value={block.body as TiptapContent}
          onChange={(body) => change((draft) => void ((draft as typeof block).body = body))}
        />
      )
    case 'ideas':
      return (
        <div className="flex gap-2">
          <OptionSelect
            label="Order"
            value={block.sort}
            options={[
              ['trending', 'Trending'],
              ['top', 'Top'],
              ['new', 'New'],
            ]}
            onChange={(sort) => change((draft) => void ((draft as typeof block).sort = sort))}
          />
          <OptionSelect
            label="Ideas"
            value={String(block.count) as '3' | '5'}
            options={[
              ['3', '3 ideas'],
              ['5', '5 ideas'],
            ]}
            onChange={(count) =>
              change((draft) => void ((draft as typeof block).count = Number(count) as 3 | 5))
            }
          />
        </div>
      )
    case 'updates':
      return (
        <OptionSelect
          label="Updates"
          value={String(block.count) as '2' | '3' | '4'}
          options={[
            ['2', '2 updates'],
            ['3', '3 updates'],
            ['4', '4 updates'],
          ]}
          onChange={(count) =>
            change((draft) => void ((draft as typeof block).count = Number(count) as 2 | 3 | 4))
          }
        />
      )
    case 'roadmap':
      return <RoadmapOption block={block} change={change} />
    case 'links':
      return <LinksOptions block={block} change={change} />
    default:
      return null
  }
}

function OptionSelect<T extends string>({
  label,
  value,
  options,
  onChange,
  wide = false,
}: {
  label: string
  value: T
  options: Array<[T, string]>
  onChange: (value: T) => void
  /** For options named at length, such as roadmaps. */
  wide?: boolean
}) {
  return (
    <Select value={value} onValueChange={(next) => onChange(next as T)}>
      <SelectTrigger size="sm" aria-label={label} className={wide ? 'w-[220px]' : 'w-[140px]'}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map(([option, name]) => (
          <SelectItem key={option} value={option}>
            {name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

const FIRST_ROADMAP = 'first'

function RoadmapOption({
  block,
  change,
}: {
  block: Extract<HomeBlock, { type: 'roadmap' }>
  change: (apply: (draft: HomeBlock) => void) => void
}) {
  const { data: roadmaps = [] } = useQuery(adminQueries.roadmaps())
  const shown = roadmaps.filter((roadmap) => roadmap.visibility === 'public')
  return (
    <OptionSelect
      label="Roadmap"
      wide
      value={block.roadmapId ?? FIRST_ROADMAP}
      options={[
        [FIRST_ROADMAP, 'First public roadmap'],
        ...shown.map((roadmap) => [roadmap.id, roadmap.name] as [string, string]),
      ]}
      onChange={(id) =>
        change(
          (draft) =>
            void ((draft as typeof block).roadmapId =
              id === FIRST_ROADMAP ? null : (id as typeof block.roadmapId))
        )
      }
    />
  )
}

type Link = Extract<HomeBlock, { type: 'links' }>['links'][number]

/** A link the design accepts: a name and an http(s) address. */
function validLink(link: Link): boolean {
  const label = link.label.trim()
  return label.length > 0 && label.length <= 40 && /^https?:\/\/[^\s]+$/i.test(link.url.trim())
}

/**
 * The block's heading and links. A link reaches the draft once it has a
 * name and a full web address, so a half-typed one is never saved.
 */
function LinksOptions({
  block,
  change,
}: {
  block: Extract<HomeBlock, { type: 'links' }>
  change: (apply: (draft: HomeBlock) => void) => void
}) {
  const [links, setLinks] = useState<Link[]>(block.links)
  const commit = (next: Link[]) => {
    setLinks(next)
    const valid = next.filter(validLink)
    if (valid.length > 0 && valid.length === next.length)
      change((draft) => void ((draft as typeof block).links = valid))
  }
  return (
    <div className="space-y-2">
      <Input
        aria-label="Links heading"
        placeholder="Links"
        value={block.title ?? ''}
        maxLength={40}
        onChange={(event) =>
          change((draft) => {
            const title = event.target.value.trim() ? event.target.value : undefined
            if (title) (draft as typeof block).title = title
            else delete (draft as typeof block).title
          })
        }
      />
      {links.map((link, index) => (
        <div key={index} className="flex items-center gap-1.5">
          <Input
            aria-label={`Link ${index + 1} name`}
            placeholder="Name"
            value={link.label}
            maxLength={40}
            className="w-1/3"
            onChange={(event) =>
              commit(links.map((l, i) => (i === index ? { ...l, label: event.target.value } : l)))
            }
          />
          <Input
            aria-label={`Link ${index + 1} address`}
            placeholder="https://example.com"
            type="url"
            value={link.url}
            aria-invalid={link.url !== '' && !validLink({ label: 'x', url: link.url })}
            onChange={(event) =>
              commit(links.map((l, i) => (i === index ? { ...l, url: event.target.value } : l)))
            }
          />
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Remove link ${index + 1}`}
            disabled={links.length === 1}
            onClick={() => commit(links.filter((_, i) => i !== index))}
          >
            <Icon path={CROSS} className="size-4" />
          </Button>
        </div>
      ))}
      <Button
        variant="ghost"
        size="sm"
        disabled={links.length >= 6}
        onClick={() => setLinks([...links, { label: '', url: '' }])}
      >
        <Icon path={PLUS} className="size-4" />
        Add a link
      </Button>
    </div>
  )
}
