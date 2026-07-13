import { useState } from 'react'
import { useIntl } from 'react-intl'
import { ChevronDownIcon, InformationCircleIcon } from '@heroicons/react/24/outline'
import { cn } from '@/lib/shared/utils'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  COMPONENT_STATUS_STYLE,
  COMPONENT_STATUS_LABEL,
  worstComponentStatus,
} from './status-colors'
import { StatusUptimeBar, type StatusUptimeDay } from './status-uptime-bar'
import type { StatusComponentId, StatusComponentGroupId } from '@quackback/ids'
import type { StatusComponentStatus } from '@/lib/server/domains/status'

export interface StatusComponentData {
  id: StatusComponentId
  name: string
  description: string | null
  status: StatusComponentStatus
  showUptime: boolean
}

export interface StatusComponentGroupData {
  id: StatusComponentGroupId
  name: string
  collapsed: boolean
  components: StatusComponentData[]
}

interface StatusComponentsListProps {
  groups: StatusComponentGroupData[]
  ungroupedComponents: StatusComponentData[]
  /** 90-day series per component id — components with `showUptime: false` or
   *  no entry simply render without the uptime bar. */
  uptimeByComponentId: Map<string, StatusUptimeDay[]>
  className?: string
}

function ComponentRow({
  component,
  uptimeDays,
  indent,
}: {
  component: StatusComponentData
  uptimeDays: StatusUptimeDay[] | undefined
  indent?: boolean
}) {
  const intl = useIntl()
  const style = COMPONENT_STATUS_STYLE[component.status]
  const label = intl.formatMessage(COMPONENT_STATUS_LABEL[component.status])
  const showBar = component.showUptime && uptimeDays && uptimeDays.length > 0

  return (
    <div className={cn('flex flex-col gap-2.5 px-4 py-3.5 sm:px-[18px]', indent && 'sm:pl-9')}>
      <div className="flex items-center justify-between gap-3">
        <span className="flex min-w-0 items-center gap-1.5 text-sm font-medium">
          <span className="truncate">{component.name}</span>
          {component.description && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className="shrink-0 text-muted-foreground/50 hover:text-muted-foreground"
                >
                  <InformationCircleIcon className="h-3.5 w-3.5" />
                  <span className="sr-only">{component.description}</span>
                </button>
              </TooltipTrigger>
              <TooltipContent>{component.description}</TooltipContent>
            </Tooltip>
          )}
        </span>
        <span
          className={cn('flex shrink-0 items-center gap-1.5 text-[12.5px] font-medium', style.text)}
        >
          <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', style.dot)} />
          {label}
        </span>
      </div>
      {showBar && <StatusUptimeBar days={uptimeDays} />}
    </div>
  )
}

function ComponentGroupSection({
  group,
  uptimeByComponentId,
}: {
  group: StatusComponentGroupData
  uptimeByComponentId: Map<string, StatusUptimeDay[]>
}) {
  const [open, setOpen] = useState(!group.collapsed)
  const worst = worstComponentStatus(group.components.map((c) => c.status))
  const style = COMPONENT_STATUS_STYLE[worst]

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="flex w-full items-center gap-2 bg-muted/30 px-4 py-2.5 text-left text-[13px] font-semibold text-muted-foreground hover:bg-muted/50 sm:px-[18px]"
        >
          <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', style.dot)} />
          {group.name}
          <ChevronDownIcon
            className={cn(
              'ml-auto h-3.5 w-3.5 shrink-0 transition-transform duration-200',
              open && 'rotate-180'
            )}
          />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="divide-y divide-border/40">
          {group.components.map((component) => (
            <ComponentRow
              key={component.id}
              component={component}
              uptimeDays={uptimeByComponentId.get(component.id)}
              indent
            />
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

/** The single bordered "current status by service" card: ungrouped
 *  components first, then each group as a collapsible section with a
 *  rolled-up worst-status dot in its header. */
export function StatusComponentsList({
  groups,
  ungroupedComponents,
  uptimeByComponentId,
  className,
}: StatusComponentsListProps) {
  return (
    <div
      className={cn(
        'overflow-hidden rounded-2xl border border-border/50 bg-card shadow-xs',
        className
      )}
    >
      <div className="divide-y divide-border/40">
        {ungroupedComponents.map((component) => (
          <ComponentRow
            key={component.id}
            component={component}
            uptimeDays={uptimeByComponentId.get(component.id)}
          />
        ))}
      </div>
      {groups.map((group) => (
        <ComponentGroupSection
          key={group.id}
          group={group}
          uptimeByComponentId={uptimeByComponentId}
        />
      ))}
    </div>
  )
}
