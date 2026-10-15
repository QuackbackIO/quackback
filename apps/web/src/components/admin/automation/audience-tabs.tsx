import type { ReactNode } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

export interface AudienceTabSpec {
  value: string
  label: string
  content: ReactNode
}

/**
 * The line tabs of a Quackback AI page that serves more than one audience
 * ("For customers", "For teammates"). Every tab stays mounted so an edit in
 * one survives a look at the other.
 */
export function AudienceTabs({
  tabs,
  value,
  onValueChange,
}: {
  tabs: AudienceTabSpec[]
  value: string
  onValueChange: (value: string) => void
}) {
  if (tabs.length === 1) return <div className="space-y-6">{tabs[0]!.content}</div>
  return (
    <Tabs value={value} onValueChange={onValueChange} variant="line" className="space-y-6">
      <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <TabsList className="w-max min-w-full">
          {tabs.map((tab) => (
            <TabsTrigger key={tab.value} value={tab.value}>
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </div>
      {tabs.map((tab) => (
        <TabsContent key={tab.value} value={tab.value} keepMounted className="space-y-6">
          {tab.content}
        </TabsContent>
      ))}
    </Tabs>
  )
}
