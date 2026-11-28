import { useOptionalIntl } from '@/components/ui/use-optional-intl'
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
  type ConversationSort,
} from '@/lib/shared/conversation/views'
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
import { PRIORITY_LABELS, SORT_LABELS, STATUS_LABELS, STATUS_WORDS } from './inbox-labels'

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
  const intl = useOptionalIntl()
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
        options={sorts.map((s) => ({ value: s, label: intl.formatMessage(SORT_LABELS[s]) }))}
        value={sort}
        onChange={(next) => onSort(next as ConversationSort)}
        formatLabel={(label) => intl.formatMessage(STATUS_WORDS.sortBy, { label })}
      />

      {showRefinements && (
        <>
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="outline" size="sm" />}>
              <span className="capitalize">
                {intl.formatMessage(facet === 'all' ? STATUS_WORDS.status : STATUS_LABELS[facet])}
              </span>
              <ChevronDownIcon className="size-3.5 text-muted-foreground" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem onClick={() => onFacet('all')}>
                {intl.formatMessage({
                  id: 'admin.inbox.conversationListToolbar.all',
                  defaultMessage: 'All',
                })}
              </DropdownMenuItem>
              {TRIAGE_FACETS.map((f) => (
                <DropdownMenuItem key={f} onClick={() => onFacet(f)} className="capitalize">
                  {intl.formatMessage(STATUS_LABELS[f as Exclude<InboxTriageFacet, 'all'>])}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu open={filterOpen} onOpenChange={setFilterOpen}>
            <DropdownMenuTrigger
              render={<Button variant="outline" size="sm" className="border-dashed" />}
            >
              <PlusIcon className="size-3.5" />
              {intl.formatMessage({
                id: 'admin.inbox.conversationListToolbar.filter',
                defaultMessage: 'Filter',
              })}
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
                  {intl.formatMessage({
                    id: 'admin.inbox.conversationListToolbar.priority',
                    defaultMessage: 'Priority',
                  })}
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  <DropdownMenuItem onClick={() => onPriorityFilter('all')}>
                    {intl.formatMessage({
                      id: 'admin.inbox.conversationListToolbar.allPriorities',
                      defaultMessage: 'All priorities',
                    })}
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
                    {intl.formatMessage({
                      id: 'admin.inbox.conversationListToolbar.channel',
                      defaultMessage: 'Channel',
                    })}
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent>
                    <DropdownMenuItem onClick={() => onChannelFilter(undefined)}>
                      {intl.formatMessage({
                        id: 'admin.inbox.conversationListToolbar.anyChannel',
                        defaultMessage: 'Any channel',
                      })}
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
                    {intl.formatMessage({
                      id: 'admin.inbox.conversationListToolbar.type',
                      defaultMessage: 'Type',
                    })}
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent>
                    <DropdownMenuItem onClick={() => onTicketTypeFilter(undefined)}>
                      {intl.formatMessage({
                        id: 'admin.inbox.conversationListToolbar.allTypes',
                        defaultMessage: 'All types',
                      })}
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
                    {intl.formatMessage({
                      id: 'admin.inbox.conversationListToolbar.company',
                      defaultMessage: 'Company',
                    })}
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent className="max-h-72 overflow-y-auto">
                    <DropdownMenuItem onClick={() => companyFilter.onChange(undefined)}>
                      {intl.formatMessage({
                        id: 'admin.inbox.conversationListToolbar.allCompanies',
                        defaultMessage: 'All companies',
                      })}
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
              label={intl.formatMessage({
                id: 'admin.inbox.conversationListToolbar.priority2',
                defaultMessage: 'Priority',
              })}
              value={intl.formatMessage(PRIORITY_LABELS[priorityFilter])}
              valueId={priorityFilter}
              onRemove={() => onPriorityFilter('all')}
            />
          )}
          {activeChannel && onChannelFilter && (
            <FilterChip
              icon={ChatBubbleOvalLeftIcon}
              label={intl.formatMessage({
                id: 'admin.inbox.conversationListToolbar.channel2',
                defaultMessage: 'Channel',
              })}
              value={activeChannel.label}
              valueId={activeChannel.id}
              onRemove={() => onChannelFilter(undefined)}
            />
          )}
          {activeType && onTicketTypeFilter && (
            <FilterChip
              icon={TicketIcon}
              label={intl.formatMessage({
                id: 'admin.inbox.conversationListToolbar.type2',
                defaultMessage: 'Type',
              })}
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
          label={intl.formatMessage({
            id: 'admin.inbox.conversationListToolbar.company2',
            defaultMessage: 'Company',
          })}
          value={activeCompany.name}
          valueId={activeCompany.id}
          onRemove={() => companyFilter.onChange(undefined)}
        />
      )}
    </div>
  )
}
