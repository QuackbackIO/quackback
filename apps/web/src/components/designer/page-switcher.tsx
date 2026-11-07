import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { defaultFilter } from 'cmdk'
import {
  ArrowLeftIcon,
  ChevronDownIcon,
  HomeIcon,
  ListBulletIcon,
  PlusIcon,
} from '@heroicons/react/16/solid'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { trackBuilder } from '@/lib/client/builder-events'
import { listDesignerPlacesFn } from '@/lib/server/functions/portal-designer'
import { menuParts } from '@/lib/shared/design/menu'
import { PAGE_NAMES, type CanvasLocation, type DesignerPage } from '@/lib/shared/design/outline'
import {
  CHOOSE_PAGES,
  CHOOSE_TITLES,
  NO_PLACES,
  SWITCHER_COPY,
  switcherColumns,
  type ChooseList,
  type DesignerPlaces,
  type SwitcherColumn,
  type SwitcherRow,
} from '@/lib/shared/design/page-switcher'
import type { PortalPageGates } from '@/lib/shared/design/paths'
import type { SamplePage } from '@/lib/shared/design/sample-pages'
import type { PortalDesign } from '@/lib/shared/design/schema'
import { cn } from '@/lib/shared/utils'

/**
 * The switcher's search: cmdk's own scoring, with a row whose name starts
 * with the search leading, so "roadmap" leads with the Roadmap page and not
 * a board on it. A row's name is its first keyword.
 */
export function switcherFilter(value: string, search: string, keywords: string[] = []): number {
  const score = defaultFilter(value, search, keywords)
  const name = keywords[0]?.toLowerCase() ?? ''
  return score > 0 && search && name.startsWith(search.trim().toLowerCase()) ? score + 1 : score
}

const ROW =
  'min-h-8 py-1.5 text-[13px] data-[current=true]:bg-muted data-[current=true]:font-medium'

/** What the switcher lists, read when it first opens. */
function usePlaces(enabled: boolean) {
  return useQuery({
    queryKey: ['designer', 'places'],
    queryFn: async () => {
      const answer = await listDesignerPlacesFn()
      return answer.ok ? answer.places : NO_PLACES
    },
    enabled,
    staleTime: 60_000,
  })
}

/** The page's name on the switcher's button: its name in the menu where it has one. */
function pageName(design: PortalDesign, gates: PortalPageGates, page: DesignerPage): string {
  return menuParts(design, gates).find((part) => part.id === page)?.label ?? PAGE_NAMES[page]
}

/**
 * "Page: <name>": every page of the customer portal by module, with search,
 * opening a list to choose a single post, entry or article, and the parts
 * turned off as samples. Arrow keys move and Enter goes.
 */
export function PageSwitcher({
  design,
  gates,
  here,
  sample,
  onPage,
  onSample,
  onTurnOn,
}: {
  design: PortalDesign
  gates: PortalPageGates
  here: CanvasLocation
  sample: SamplePage | null
  onPage: (page: DesignerPage, item: string | null) => void
  onSample: (page: SamplePage) => void
  /** "Turn one on": the menu's "+". */
  onTurnOn: () => void
}) {
  const [open, setOpen] = useState(false)
  const { data: places, isPending } = usePlaces(open)
  const columns = useMemo(
    () => switcherColumns({ design, gates, places: places ?? NO_PLACES, here, sample }),
    [design, gates, places, here, sample]
  )
  const done = (then: () => void) => {
    setOpen(false)
    then()
  }
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) trackBuilder('designer_panel_opened', { panel: 'pages' })
      }}
    >
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          aria-haspopup="dialog"
          className="gap-1.5 border-border font-normal data-popup-open:border-foreground"
        >
          <span className="text-muted-foreground">{SWITCHER_COPY.page}</span>
          <span className="max-w-40 truncate font-semibold">
            {sample ? PAGE_NAMES[sample] : pageName(design, gates, here.page)}
          </span>
          <ChevronDownIcon className="size-3.5" aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" aria-label="Pages" className="w-[min(92vw,960px)] p-0">
        <SwitcherMenu
          columns={columns}
          places={places ?? NO_PLACES}
          loading={isPending}
          onPage={(page, item) => done(() => onPage(page, item))}
          onSample={(page) => done(() => onSample(page))}
          onTurnOn={() => done(onTurnOn)}
        />
      </PopoverContent>
    </Popover>
  )
}

/** The switcher's search and columns, or the list "Choose one" opens. */
export function SwitcherMenu({
  columns,
  places,
  loading,
  onPage,
  onSample,
  onTurnOn,
}: {
  columns: SwitcherColumn[]
  places: DesignerPlaces
  loading: boolean
  onPage: (page: DesignerPage, item: string | null) => void
  onSample: (page: SamplePage) => void
  onTurnOn: () => void
}) {
  const [choosing, setChoosing] = useState<ChooseList | null>(null)
  if (choosing)
    return (
      <ChooseOne
        list={choosing}
        items={places[choosing]}
        loading={loading}
        onBack={() => setChoosing(null)}
        onChoose={(path) => onPage(CHOOSE_PAGES[choosing], path)}
      />
    )
  const go = (row: SwitcherRow) => {
    const target = row.go
    if (target.kind === 'page') onPage(target.page, target.item)
    else if (target.kind === 'choose') setChoosing(target.list)
    else if (target.kind === 'sample') onSample(target.page)
    else if (target.kind === 'turn-on') onTurnOn()
  }
  // The page shown is where the arrows start.
  const current = columns.flatMap((column) => column.rows).find((row) => row.current)
  return (
    <Command
      className="rounded-panel border-0 shadow-none"
      defaultValue={current ? valueOf(current) : undefined}
      filter={switcherFilter}
      loop
    >
      <div className="flex items-center gap-3 p-3 pb-2">
        <div className="min-w-0 flex-1 rounded-md border border-border [&_[cmdk-input-wrapper]]:border-b-0">
          <CommandInput placeholder={SWITCHER_COPY.search} aria-label={SWITCHER_COPY.search} />
        </div>
        <span className="hidden shrink-0 text-xs text-muted-foreground sm:block">
          {SWITCHER_COPY.keys}
        </span>
      </div>
      <CommandList className="max-h-[min(62vh,560px)] border-t border-border px-2 pt-2">
        <CommandEmpty className="py-6 text-center text-[13px] text-muted-foreground">
          {SWITCHER_COPY.empty}
        </CommandEmpty>
        <div className="grid grid-cols-1 gap-x-2 gap-y-1 sm:grid-cols-2 lg:grid-cols-3">
          {columns.map((column) => (
            <CommandGroup
              key={column.key}
              className={cn(column.key === 'off' && 'rounded-lg bg-muted/50')}
              heading={
                <span className="block normal-case">
                  <span className="block text-[13px] font-semibold text-foreground">
                    {column.title}
                  </span>
                  <span className="flex items-center gap-1 text-[11px] font-normal text-muted-foreground">
                    {column.menuNote && <ListBulletIcon className="size-3.5" aria-hidden="true" />}
                    {column.note}
                  </span>
                </span>
              }
            >
              {column.rows.map((row) => (
                <CommandItem
                  key={row.key}
                  value={valueOf(row)}
                  keywords={[row.label, ...row.keywords]}
                  disabled={row.go.kind === 'none'}
                  data-current={row.current ? 'true' : undefined}
                  aria-current={row.current ? 'page' : undefined}
                  onSelect={() => go(row)}
                  className={cn(ROW, row.indent && 'ps-5')}
                >
                  {row.go.kind === 'turn-on' && <PlusIcon aria-hidden="true" />}
                  <span className="truncate">{row.label}</span>
                  {row.hint && (
                    <span
                      className={cn(
                        'ms-auto flex shrink-0 items-center gap-1 text-xs text-muted-foreground',
                        row.go.kind === 'sample' &&
                          !row.current &&
                          'rounded border border-border bg-background px-1.5 text-[11px]'
                      )}
                    >
                      {row.hint === SWITCHER_COPY.lands && (
                        <HomeIcon className="size-3.5" aria-hidden="true" />
                      )}
                      {row.hint}
                    </span>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          ))}
        </div>
      </CommandList>
    </Command>
  )
}

/** A row's value for cmdk: unique, and found by its words. */
const valueOf = (row: SwitcherRow) => `${row.label} ${row.key}`

/** The list "Choose one" opens: a real post, entry or article to show. */
function ChooseOne({
  list,
  items,
  loading,
  onBack,
  onChoose,
}: {
  list: ChooseList
  items: DesignerPlaces['posts']
  loading: boolean
  onBack: () => void
  onChoose: (path: string) => void
}) {
  return (
    <Command className="rounded-panel border-0 shadow-none" loop>
      <div className="flex items-center gap-2 p-3 pb-2">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeftIcon className="size-4" aria-hidden="true" />
          {SWITCHER_COPY.back}
        </Button>
        <h2 className="text-[13px] font-semibold">{CHOOSE_TITLES[list]}</h2>
      </div>
      <div className="mx-3 rounded-md border border-border [&_[cmdk-input-wrapper]]:border-b-0">
        <CommandInput
          autoFocus
          placeholder={SWITCHER_COPY.findOne}
          aria-label={CHOOSE_TITLES[list]}
        />
      </div>
      <CommandList className="max-h-[min(55vh,480px)] p-2">
        <CommandEmpty className="py-6 text-center text-[13px] text-muted-foreground">
          {loading ? SWITCHER_COPY.loading : SWITCHER_COPY.nothing}
        </CommandEmpty>
        {items.map((item) => (
          <CommandItem
            key={item.id}
            value={`${item.title} ${item.id}`}
            onSelect={() => onChoose(item.path)}
            className={ROW}
          >
            <span className="truncate">{item.title}</span>
          </CommandItem>
        ))}
      </CommandList>
    </Command>
  )
}
