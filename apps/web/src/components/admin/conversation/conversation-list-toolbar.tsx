import { useState } from 'react'
import {
  BuildingOffice2Icon,
  ChatBubbleOvalLeftIcon,
  FlagIcon,
  TicketIcon,
} from '@heroicons/react/24/solid'
import { ChevronDownIcon, PlusIcon } from '@heroicons/react/16/solid'
import type { Channel, ConversationPriority } from '@/lib/shared/conversation/types'
import { listChannelDescriptors } from '@/lib/shared/channels'
import type { InboxTriageFacet } from '@/lib/shared/inbox/items'
import {
  CONVERSATION_SORTS,
  TERMLESS_CONVERSATION_SORTS,
  CONVERSATION_SORT_LABELS,
  type ConversationSort,
} from '@/lib/shared/conversation/views'
import { priorityMeta } from '@/lib/shared/conversation/priority-meta'
import { PriorityMenuItems } from '@/components/admin/conversation/priority-control'
import { FilterChip } from '@/components/shared/filter-chip'
import { SortMenu } from '@/components/shared/sort-menu'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

const TRIAGE_FACETS: readonly InboxTriageFacet[] = ['open', 'waiting', 'closed']

export interface CompanyFilter {
  companies: { id: string; name: string }[]
  value: string | undefined
  onChange: (companyId: string | undefined) => void
}

export interface ConversationListToolbarProps {
  /** Whether the list is a search: it decides the implicit sort and whether
   *  the term-scored sort is offered. */
  searching: boolean
  showRefinements: boolean
  facet: InboxTriageFacet
  onFacet: (value: InboxTriageFacet) => void
  priorityFilter: ConversationPriority | 'all'
  onPriorityFilter: (value: ConversationPriority | 'all') => void
  ticketTypeFilter?: string
  onTicketTypeFilter?: (id: string | undefined) => void
  ticketTypeOptions?: Array<{ id: string; name: string; icon: string | null; color: string }>
  channelFilter?: Channel
  onChannelFilter?: (value: Channel | undefined) => void
  companyFilter?: CompanyFilter
  sort: ConversationSort
  onSort: (value: ConversationSort) => void
}

/**
 * The list column's toolbar: a Sort menu, the status menu and one Filter menu
 * holding every other refinement, then a removable chip per active filter. It
 * wraps so nothing is clipped at the column edge.
 */
export function ConversationListToolbar({
  searching,
  showRefinements,
  facet,
  onFacet,
  priorityFilter,
  onPriorityFilter,
  ticketTypeFilter,
  onTicketTypeFilter,
  ticketTypeOptions,
  channelFilter,
  onChannelFilter,
  companyFilter,
  sort,
  onSort,
}: ConversationListToolbarProps) {
  const [filterOpen, setFilterOpen] = useState(false)
  const sorts = searching ? CONVERSATION_SORTS : TERMLESS_CONVERSATION_SORTS
  const channels = listChannelDescriptors()
  const activeType = ticketTypeOptions?.find((t) => t.id === ticketTypeFilter)
  const activeCompany = companyFilter?.companies.find((c) => c.id === companyFilter.value)
  const activeChannel = channels.find((d) => d.id === channelFilter)

  const activeCount =
    (priorityFilter !== 'all' ? 1 : 0) +
    (channelFilter ? 1 : 0) +
    (activeType ? 1 : 0) +
    (activeCompany ? 1 : 0)

  return (
    <div className="flex flex-wrap items-center gap-1.5 px-3 py-2">
      {/* Sort applies to every scope. Best match ranks a searched list by
          default and is offered only while a term is active. */}
      <SortMenu
        options={sorts.map((s) => ({ value: s, label: CONVERSATION_SORT_LABELS[s] }))}
        value={sort}
        onChange={(next) => onSort(next as ConversationSort)}
      />

      {showRefinements && (
        <>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={<Button variant="outline" size="sm" className="font-normal" />}
            >
              <span className="capitalize">{facet === 'all' ? 'Status' : facet}</span>
              <ChevronDownIcon className="size-3.5 text-muted-foreground" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem onClick={() => onFacet('all')}>All</DropdownMenuItem>
              {TRIAGE_FACETS.map((f) => (
                <DropdownMenuItem key={f} onClick={() => onFacet(f)} className="capitalize">
                  {f}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu open={filterOpen} onOpenChange={setFilterOpen}>
            <DropdownMenuTrigger
              render={<Button variant="outline" size="sm" className="border-dashed font-normal" />}
            >
              <PlusIcon className="size-3.5" />
              Filter
              {activeCount > 0 && (
                <span className="rounded-full bg-primary/15 px-1.5 text-[11px] font-medium tabular-nums text-foreground">
                  {activeCount}
                </span>
              )}
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-44">
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <FlagIcon className="size-4" />
                  Priority
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  <DropdownMenuItem onClick={() => onPriorityFilter('all')}>
                    All priorities
                  </DropdownMenuItem>
                  <PriorityMenuItems
                    selected={priorityFilter === 'all' ? undefined : priorityFilter}
                    onSelect={onPriorityFilter}
                  />
                </DropdownMenuSubContent>
              </DropdownMenuSub>

              {onChannelFilter && (
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>
                    <ChatBubbleOvalLeftIcon className="size-4" />
                    Channel
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent>
                    <DropdownMenuItem onClick={() => onChannelFilter(undefined)}>
                      Any channel
                    </DropdownMenuItem>
                    {channels.map((d) => (
                      <DropdownMenuItem key={d.id} onClick={() => onChannelFilter(d.id)}>
                        {d.label}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              )}

              {ticketTypeOptions && onTicketTypeFilter && (
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>
                    <TicketIcon className="size-4" />
                    Type
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent>
                    <DropdownMenuItem onClick={() => onTicketTypeFilter(undefined)}>
                      All types
                    </DropdownMenuItem>
                    {ticketTypeOptions.map((t) => (
                      <DropdownMenuItem key={t.id} onClick={() => onTicketTypeFilter(t.id)}>
                        <span aria-hidden>{t.icon}</span> {t.name}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              )}

              {companyFilter && (
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>
                    <BuildingOffice2Icon className="size-4" />
                    Company
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent className="max-h-72 overflow-y-auto">
                    <DropdownMenuItem onClick={() => companyFilter.onChange(undefined)}>
                      All companies
                    </DropdownMenuItem>
                    {companyFilter.companies.map((co) => (
                      <DropdownMenuItem key={co.id} onClick={() => companyFilter.onChange(co.id)}>
                        {co.name}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              )}
            </DropdownMenuContent>
          </DropdownMenu>

          {priorityFilter !== 'all' && (
            <FilterChip
              icon={FlagIcon}
              label="Priority"
              value={priorityMeta(priorityFilter).label}
              valueId={priorityFilter}
              onRemove={() => onPriorityFilter('all')}
            />
          )}
          {activeChannel && onChannelFilter && (
            <FilterChip
              icon={ChatBubbleOvalLeftIcon}
              label="Channel"
              value={activeChannel.label}
              valueId={activeChannel.id}
              onRemove={() => onChannelFilter(undefined)}
            />
          )}
          {activeType && onTicketTypeFilter && (
            <FilterChip
              icon={TicketIcon}
              label="Type"
              value={activeType.name}
              valueId={activeType.id}
              onRemove={() => onTicketTypeFilter(undefined)}
            />
          )}
        </>
      )}
      {/* A company filter narrows the list wherever it applies, so its chip
          shows and clears even where the other refinements are hidden. */}
      {activeCompany && companyFilter && (
        <FilterChip
          icon={BuildingOffice2Icon}
          label="Company"
          value={activeCompany.name}
          valueId={activeCompany.id}
          onRemove={() => companyFilter.onChange(undefined)}
        />
      )}
    </div>
  )
}
