import * as React from 'react'
import { Select as SelectPrimitive } from '@base-ui/react/select'
import { CheckIcon, ChevronDownIcon, ChevronUpIcon, XMarkIcon } from '@heroicons/react/24/solid'

import { cn } from '@/lib/shared/utils'

type SelectItemRecord = { label: React.ReactNode; value: unknown }

const SelectItemsContext = React.createContext<{
  register: (value: unknown, label: React.ReactNode) => () => void
  publish: (items: SelectItemRecord[]) => void
  lookup: (value: unknown) => React.ReactNode | undefined
} | null>(null)

function collectItemsFromChildren(node: React.ReactNode): SelectItemRecord[] {
  const items: SelectItemRecord[] = []
  React.Children.forEach(node, (child) => {
    if (!React.isValidElement(child)) return
    const type = child.type as { displayName?: string; name?: string }
    const name = type.displayName ?? type.name ?? ''
    const props = child.props as { value?: unknown; children?: React.ReactNode }
    if (name === 'SelectItem' && props.value !== undefined) {
      items.push({ value: props.value, label: props.children })
      return
    }
    if (props.children) items.push(...collectItemsFromChildren(props.children))
  })
  return items
}

type SelectProps<Value> = {
  children?: React.ReactNode
  value?: Value | null
  defaultValue?: Value | null
  onValueChange?: (value: Value) => void
  items?: SelectPrimitive.Root.Props<Value, false>['items']
  disabled?: boolean
  name?: string
  required?: boolean
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
}

function flattenLabel(node: React.ReactNode): string {
  if (node == null || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(flattenLabel).join('')
  if (React.isValidElement(node)) {
    return flattenLabel((node.props as { children?: React.ReactNode }).children)
  }
  return ''
}

function Select<Value = string>({
  items: itemsProp,
  children,
  onValueChange,
  ...props
}: SelectProps<Value>) {
  // Seed the registry from the declared children on first render so SSR and
  // the first client paint already resolve trigger labels (no raw-value flash
  // while the item effects below catch up). Lazy ref init — no setState.
  const labelsRef = React.useRef<Map<unknown, React.ReactNode> | null>(null)
  if (labelsRef.current === null) {
    labelsRef.current = new Map(
      collectItemsFromChildren(children).map((item) => [item.value, item.label])
    )
  }
  const [, setItemTick] = React.useState(0)

  // Bump a re-render outside the current commit: ref writes don't trigger one
  // on their own, and setState synchronously inside a registry write (which
  // runs from an item layout effect) would warn or loop.
  const bumpTick = React.useCallback(() => {
    queueMicrotask(() => setItemTick((tick) => tick + 1))
  }, [])

  const register = React.useCallback(
    (value: unknown, label: React.ReactNode) => {
      const existing = labelsRef.current!.get(value)
      if (existing !== undefined && flattenLabel(existing) === flattenLabel(label)) {
        return () => {}
      }
      const next = new Map(labelsRef.current!)
      next.set(value, label)
      labelsRef.current = next
      bumpTick()
      return () => {
        if (!labelsRef.current!.has(value)) return
        const copy = new Map(labelsRef.current!)
        copy.delete(value)
        labelsRef.current = copy
        bumpTick()
      }
    },
    [bumpTick]
  )

  const publish = React.useCallback(
    (items: SelectItemRecord[]) => {
      let changed = false
      const next = new Map(labelsRef.current!)
      for (const item of items) {
        const existing = next.get(item.value)
        if (existing !== undefined && flattenLabel(existing) === flattenLabel(item.label)) continue
        next.set(item.value, item.label)
        changed = true
      }
      if (!changed) return
      labelsRef.current = next
      bumpTick()
    },
    [bumpTick]
  )

  // The context value is stable across registry writes (registration only
  // mutates the ref), so item layout effects keyed on it don't churn — a
  // write can no longer feed back into itself through a fresh context object.
  // lookup reads the ref live, so labels resolve without a context change.
  const ctx = React.useMemo(
    () => ({
      register,
      publish,
      lookup: (value: unknown) => labelsRef.current!.get(value),
    }),
    [register, publish]
  )

  // The collected items array refreshes when a write swaps the map instance
  // (labelsRef.current in deps) — the microtask tick above only schedules a
  // re-render; the memo needs a changed dep to recompute on it.
  const collected = React.useMemo<SelectItemRecord[]>(
    () =>
      Array.from(labelsRef.current!, ([value, label]) => ({
        value,
        label: flattenLabel(label) || label,
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [labelsRef.current]
  )

  return (
    <SelectItemsContext.Provider value={ctx}>
      <SelectPrimitive.Root
        data-slot="select"
        items={itemsProp ?? collected}
        onValueChange={(value) => {
          if (value == null) return
          onValueChange?.(value)
        }}
        {...props}
      >
        {children}
      </SelectPrimitive.Root>
    </SelectItemsContext.Provider>
  )
}

function SelectGroup({ className, ...props }: SelectPrimitive.Group.Props) {
  return (
    <SelectPrimitive.Group
      data-slot="select-group"
      className={cn('scroll-my-1', className)}
      {...props}
    />
  )
}

function SelectValue({
  className,
  placeholder,
  children,
  ...props
}: Omit<SelectPrimitive.Value.Props, 'children'> & {
  children?: React.ReactNode | ((value: string) => React.ReactNode)
}) {
  const registry = React.useContext(SelectItemsContext)

  return (
    <SelectPrimitive.Value
      data-slot="select-value"
      placeholder={placeholder}
      className={cn('flex flex-1 text-left', className)}
      {...props}
    >
      {(value: string | null) => {
        if (typeof children === 'function') return children(value ?? '')
        if (children) return children
        if (value == null || value === '') return placeholder ?? null
        const registered = registry?.lookup(value)
        return registered ?? value
      }}
    </SelectPrimitive.Value>
  )
}

function SelectTrigger({
  className,
  size = 'default',
  children,
  onClear,
  ...props
}: SelectPrimitive.Trigger.Props & {
  size?: 'xs' | 'sm' | 'default'
  onClear?: () => void
}) {
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      data-size={size}
      className={cn(
        "border-input data-placeholder:text-muted-foreground [&_svg:not([class*='text-'])]:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive dark:bg-input/30 dark:hover:bg-input/50 flex w-fit items-center justify-between gap-2 [border-radius:calc(var(--radius)*0.8)] border bg-transparent px-3 py-2 text-sm whitespace-nowrap shadow-xs transition-[color,box-shadow] outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50 data-[size=default]:h-9 data-[size=sm]:h-8 data-[size=sm]:text-[13px] data-[size=xs]:h-6 data-[size=xs]:px-1.5 data-[size=xs]:py-0 data-[size=xs]:text-xs data-[size=xs]:gap-1 *:data-[slot=select-value]:line-clamp-1 *:data-[slot=select-value]:flex *:data-[slot=select-value]:items-center *:data-[slot=select-value]:gap-2 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 data-[size=xs]:[&_svg:not([class*='size-'])]:size-3",
        className
      )}
      {...props}
    >
      {children}
      {onClear ? (
        <span
          role="button"
          aria-label="Clear"
          tabIndex={0}
          className="pointer-events-auto opacity-40 hover:opacity-100 transition-opacity"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation()
            e.preventDefault()
            onClear()
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.stopPropagation()
              e.preventDefault()
              onClear()
            }
          }}
        >
          <XMarkIcon className="size-4" />
        </span>
      ) : (
        <SelectPrimitive.Icon render={<ChevronDownIcon className="size-4 opacity-50" />} />
      )}
    </SelectPrimitive.Trigger>
  )
}

function SelectContent({
  className,
  children,
  position = 'popper',
  align = 'center',
  side = 'bottom',
  sideOffset = 4,
  alignOffset = 0,
  ...props
}: SelectPrimitive.Popup.Props &
  Pick<SelectPrimitive.Positioner.Props, 'align' | 'alignOffset' | 'side' | 'sideOffset'> & {
    position?: 'popper' | 'item-aligned'
  }) {
  const registry = React.useContext(SelectItemsContext)
  const collected = React.useMemo(() => collectItemsFromChildren(children), [children])
  React.useLayoutEffect(() => {
    registry?.publish(collected)
  }, [registry, collected])

  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Positioner
        side={side}
        sideOffset={sideOffset}
        align={align}
        alignOffset={alignOffset}
        alignItemWithTrigger={position !== 'popper'}
        className="isolate z-50"
      >
        <SelectPrimitive.Popup
          data-slot="select-content"
          className={cn(
            'bg-popover text-popover-foreground data-open:animate-in data-closed:animate-out data-closed:fade-out-0 data-open:fade-in-0 data-closed:zoom-out-95 data-open:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 relative z-50 max-h-(--available-height) min-w-[8rem] w-(--anchor-width) origin-(--transform-origin) overflow-x-hidden overflow-y-auto [border-radius:calc(var(--radius)*0.8)] border shadow-md',
            className
          )}
          {...props}
        >
          <SelectScrollUpButton />
          <SelectPrimitive.List className="p-1">{children}</SelectPrimitive.List>
          <SelectScrollDownButton />
        </SelectPrimitive.Popup>
      </SelectPrimitive.Positioner>
    </SelectPrimitive.Portal>
  )
}

function SelectLabel({ className, ...props }: SelectPrimitive.GroupLabel.Props) {
  return (
    <SelectPrimitive.GroupLabel
      data-slot="select-label"
      className={cn('text-muted-foreground px-2 py-1.5 text-xs', className)}
      {...props}
    />
  )
}

function SelectItem({ className, children, value, ...props }: SelectPrimitive.Item.Props) {
  const registry = React.useContext(SelectItemsContext)

  React.useLayoutEffect(() => {
    if (!registry) return
    return registry.register(value, children)
  }, [registry, value, children])

  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      value={value}
      className={cn(
        "focus:bg-accent focus:text-accent-foreground [&_svg:not([class*='text-'])]:text-muted-foreground relative flex w-full cursor-default items-center gap-2 rounded-sm py-1.5 pr-8 pl-2 text-[13px] outline-hidden select-none data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 *:[span]:last:flex *:[span]:last:items-center *:[span]:last:gap-2",
        className
      )}
      {...props}
    >
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
      <SelectPrimitive.ItemIndicator
        render={<span className="absolute right-2 flex size-3.5 items-center justify-center" />}
      >
        <CheckIcon className="size-4" />
      </SelectPrimitive.ItemIndicator>
    </SelectPrimitive.Item>
  )
}
SelectItem.displayName = 'SelectItem'

function SelectSeparator({ className, ...props }: SelectPrimitive.Separator.Props) {
  return (
    <SelectPrimitive.Separator
      data-slot="select-separator"
      className={cn('bg-border pointer-events-none -mx-1 my-1 h-px', className)}
      {...props}
    />
  )
}

function SelectScrollUpButton({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollUpArrow>) {
  return (
    <SelectPrimitive.ScrollUpArrow
      data-slot="select-scroll-up-button"
      className={cn('flex cursor-default items-center justify-center py-1', className)}
      {...props}
    >
      <ChevronUpIcon className="size-4" />
    </SelectPrimitive.ScrollUpArrow>
  )
}

function SelectScrollDownButton({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollDownArrow>) {
  return (
    <SelectPrimitive.ScrollDownArrow
      data-slot="select-scroll-down-button"
      className={cn('flex cursor-default items-center justify-center py-1', className)}
      {...props}
    >
      <ChevronDownIcon className="size-4" />
    </SelectPrimitive.ScrollDownArrow>
  )
}

export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectScrollDownButton,
  SelectScrollUpButton,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
}
