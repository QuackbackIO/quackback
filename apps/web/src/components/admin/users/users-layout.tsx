import { ScrollArea } from '@/components/ui/scroll-area'

interface UsersLayoutProps {
  segmentNav: React.ReactNode
  userList: React.ReactNode
  userDetail: React.ReactNode
}

export function UsersLayout({ segmentNav, userList, userDetail }: UsersLayoutProps) {
  return (
    <div className="flex h-full bg-background">
      {/* Segment Nav - Desktop */}
      <aside className="hidden lg:flex w-64 xl:w-72 shrink-0 flex-col border-r border-border/50 bg-card/30 overflow-hidden">
        <ScrollArea className="h-full">
          <div className="p-5">{segmentNav}</div>
        </ScrollArea>
      </aside>

      {/* User List */}
      <main className="flex-1 lg:flex-none lg:w-[540px] shrink-0 flex flex-col border-r border-border/50 bg-card overflow-hidden">
        <ScrollArea className="h-full">{userList}</ScrollArea>
      </main>

      {/* User Detail */}
      <aside className="hidden md:flex flex-1 min-w-0 flex-col bg-background overflow-hidden">
        <ScrollArea className="h-full">{userDetail}</ScrollArea>
      </aside>
    </div>
  )
}
