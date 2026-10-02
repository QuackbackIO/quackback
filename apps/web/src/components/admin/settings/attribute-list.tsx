import type { ComponentProps, ReactNode } from 'react'
import { Squares2X2Icon } from '@heroicons/react/24/outline'
import { EmptyState } from '@/components/shared/empty-state'
import { NewButton } from '@/components/shared/new-button'
import { cn } from '@/lib/shared/utils'
import { SettingsCard } from './settings-card'
import { RowActions, SettingsList, SettingsListRow } from './settings-list'

const BUILTIN_ACTIONS: ComponentProps<typeof RowActions>['items'] = [
  {
    label: 'Delete',
    destructive: true,
    disabled: true,
    hint: 'Built-in attributes cannot be deleted',
    onSelect: () => {},
  },
]

/** One row of an attribute list: a built-in field or a custom attribute. */
export interface AttributeListItem {
  id: string
  label: string
  /** The machine key, shown in mono after the label. */
  attrKey: string
  /** The human type name ("Text", "Select"), shown muted after the key. */
  typeLabel: string
  description?: string | null
  /** Built-in fields are fixed: the menu offers only a disabled Delete with the reason. */
  builtin?: boolean
  /** Extra state badges (AI, Required to close, Archived). */
  badges?: ReactNode
  /** Dims the row (archived attributes). */
  muted?: boolean
  actions?: ComponentProps<typeof RowActions>['items']
}

interface AttributeListProps {
  items: AttributeListItem[]
  onNew: () => void
  /** One clause under "No attributes yet". */
  emptyDescription?: string
  /** Dialogs owned by the entity-specific list. */
  children?: ReactNode
}

/**
 * The attribute registry card shared by Users, Companies and Conversations:
 * header with the create action, one row per field, and the empty state. The
 * entity lists own their dialogs, built-in field sets and mutations.
 */
export function AttributeList({ items, onNew, emptyDescription, children }: AttributeListProps) {
  return (
    <SettingsCard title="Attributes" flush action={<NewButton noun="attribute" onClick={onNew} />}>
      {items.length === 0 ? (
        <EmptyState
          size="compact"
          icon={Squares2X2Icon}
          title="No attributes yet"
          description={emptyDescription}
          action={<NewButton noun="attribute" onClick={onNew} />}
        />
      ) : (
        <SettingsList>
          {items.map((item) => (
            <div key={item.id} className={cn(item.muted && 'opacity-60')}>
              <SettingsListRow
                title={item.label}
                badges={
                  <>
                    <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] font-normal text-muted-foreground">
                      {item.attrKey}
                    </code>
                    <span className="text-[13px] font-normal text-muted-foreground">
                      {item.typeLabel}
                    </span>
                    {item.badges}
                  </>
                }
                meta={item.description || undefined}
                actions={item.builtin ? BUILTIN_ACTIONS : item.actions}
              />
            </div>
          ))}
        </SettingsList>
      )}
      {children}
    </SettingsCard>
  )
}
