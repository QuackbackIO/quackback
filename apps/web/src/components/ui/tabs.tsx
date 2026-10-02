import * as React from 'react'
import { Tabs as TabsPrimitive } from '@base-ui/react/tabs'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/shared/utils'

/**
 * shadcn/ui Tabs, extended with a `variant` prop:
 *
 *   - "pill" (default): filled/pill style, latest shadcn registry.
 *   - "line": underline style — set `variant="line"` once on the root
 *     `<Tabs>` and it propagates to `TabsList`/`TabsTrigger` below it.
 *
 * Page-section tabs are text only; `dirty` adds the unsaved-changes dot.
 */

type TabsVariant = 'pill' | 'line'

const TabsVariantContext = React.createContext<TabsVariant>('pill')

function Tabs({
  className,
  variant = 'pill',
  ...props
}: TabsPrimitive.Root.Props & { variant?: TabsVariant }) {
  return (
    <TabsVariantContext.Provider value={variant}>
      <TabsPrimitive.Root
        data-slot="tabs"
        data-variant={variant}
        className={cn('flex flex-col gap-2', className)}
        {...props}
      />
    </TabsVariantContext.Provider>
  )
}

const tabsListVariants = cva('text-muted-foreground inline-flex items-center', {
  variants: {
    variant: {
      pill: 'h-9 w-fit justify-center rounded-item border border-border/50 p-[3px]',
      line: 'h-10 w-full justify-start gap-4 border-b border-border',
    },
  },
  defaultVariants: { variant: 'pill' },
})

function TabsList({
  className,
  variant,
  ...props
}: TabsPrimitive.List.Props & VariantProps<typeof tabsListVariants>) {
  const contextVariant = React.useContext(TabsVariantContext)
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      className={cn(tabsListVariants({ variant: variant ?? contextVariant }), className)}
      {...props}
    />
  )
}

const tabsTriggerVariants = cva(
  "inline-flex items-center justify-center gap-1.5 text-sm font-medium whitespace-nowrap [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 transition-[color,box-shadow] disabled:pointer-events-none disabled:opacity-50 data-active:font-semibold",
  {
    variants: {
      variant: {
        pill: [
          'h-[calc(100%-1px)] flex-1 rounded-item border border-transparent px-2 py-1',
          'text-foreground dark:text-muted-foreground',
          'data-active:bg-background',
          'dark:data-active:text-foreground dark:data-active:border-input dark:data-active:bg-input/30',
          'focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:outline-ring focus-visible:ring-[3px] focus-visible:outline-1',
        ],
        line: [
          '-mb-px h-full rounded-none border-b-2 border-transparent px-1 pb-3',
          'text-muted-foreground hover:text-foreground',
          'data-active:border-primary data-active:text-foreground',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        ],
      },
    },
    defaultVariants: { variant: 'pill' },
  }
)

function TabsTrigger({
  className,
  variant,
  dirty = false,
  dirtyLabel,
  children,
  ...props
}: TabsPrimitive.Tab.Props &
  VariantProps<typeof tabsTriggerVariants> & {
    /** Marks the tab as holding unsaved changes: a small dot after the label. */
    dirty?: boolean
    /** The dot's accessible text. */
    dirtyLabel?: string
  }) {
  const contextVariant = React.useContext(TabsVariantContext)
  return (
    <TabsPrimitive.Tab
      data-slot="tabs-trigger"
      className={cn(tabsTriggerVariants({ variant: variant ?? contextVariant }), className)}
      {...props}
    >
      {children}
      {dirty && (
        <>
          <span
            data-slot="tabs-trigger-dirty"
            aria-hidden="true"
            className="size-1.5 rounded-full bg-primary"
          />
          {dirtyLabel && <span className="sr-only">{dirtyLabel}</span>}
        </>
      )}
    </TabsPrimitive.Tab>
  )
}

function TabsContent({ className, ...props }: TabsPrimitive.Panel.Props) {
  return (
    <TabsPrimitive.Panel
      data-slot="tabs-content"
      className={cn('flex-1 outline-none', className)}
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsTrigger, TabsContent }
