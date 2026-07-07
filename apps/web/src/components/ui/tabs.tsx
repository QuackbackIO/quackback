import * as React from 'react'
import * as TabsPrimitive from '@radix-ui/react-tabs'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/shared/utils'

/**
 * shadcn/ui Tabs, extended with a `variant` prop:
 *
 *   - "pill" (default): filled/pill style, latest shadcn registry.
 *   - "line": underline style — set `variant="line"` once on the root
 *     `<Tabs>` and it propagates to `TabsList`/`TabsTrigger` below it.
 *
 * Icons are first-class in both variants: drop any SVG (e.g. a Heroicon)
 * directly inside a TabsTrigger and the styles below give it the right
 * size / pointer-events behavior — no consumer className overrides needed.
 */

type TabsVariant = 'pill' | 'line'

const TabsVariantContext = React.createContext<TabsVariant>('pill')

function Tabs({
  className,
  variant = 'pill',
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Root> & { variant?: TabsVariant }) {
  return (
    <TabsVariantContext.Provider value={variant}>
      <TabsPrimitive.Root
        data-slot="tabs"
        className={cn('flex flex-col gap-2', className)}
        {...props}
      />
    </TabsVariantContext.Provider>
  )
}

const tabsListVariants = cva('text-muted-foreground inline-flex items-center', {
  variants: {
    variant: {
      pill: 'bg-card h-9 w-fit justify-center rounded-lg border border-border/50 p-[3px]',
      line: 'h-10 w-full justify-start gap-4 border-b border-border',
    },
  },
  defaultVariants: { variant: 'pill' },
})

function TabsList({
  className,
  variant,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List> & VariantProps<typeof tabsListVariants>) {
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
  "inline-flex items-center justify-center gap-1.5 text-sm font-medium whitespace-nowrap [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 transition-[color,box-shadow] disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        pill: [
          'h-[calc(100%-1px)] flex-1 rounded-md border border-transparent px-2 py-1',
          'text-foreground dark:text-muted-foreground',
          'data-[state=active]:bg-background data-[state=active]:shadow-sm',
          'dark:data-[state=active]:text-foreground dark:data-[state=active]:border-input dark:data-[state=active]:bg-input/30',
          'focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:outline-ring focus-visible:ring-[3px] focus-visible:outline-1',
        ],
        line: [
          '-mb-px h-full border-b-2 border-transparent px-1 pb-3',
          'text-muted-foreground hover:text-foreground',
          'data-[state=active]:border-primary data-[state=active]:text-foreground',
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
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger> & VariantProps<typeof tabsTriggerVariants>) {
  const contextVariant = React.useContext(TabsVariantContext)
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(tabsTriggerVariants({ variant: variant ?? contextVariant }), className)}
      {...props}
    />
  )
}

function TabsContent({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn('flex-1 outline-none', className)}
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsTrigger, TabsContent }
