'use client'

import { useRouter } from 'next/navigation'
import { ChevronDown, Check, MessageSquare } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { CreateBoardDialog } from '../create-board-dialog'
import type { WorkspaceId } from '@quackback/ids'

interface Board {
  id: string
  name: string
  slug: string
}

interface BoardSettingsHeaderProps {
  currentBoard: Board
  allBoards: Board[]
  workspaceId: WorkspaceId
}

export function BoardSettingsHeader({
  currentBoard,
  allBoards,
  workspaceId,
}: BoardSettingsHeaderProps) {
  const router = useRouter()

  function handleBoardSwitch(slug: string) {
    router.push(`/admin/settings/boards/${slug}`)
  }

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <h1 className="text-xl font-medium text-foreground">Board Settings</h1>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="gap-2" data-testid="board-switcher">
                <MessageSquare className="h-4 w-4" />
                {currentBoard.name}
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56">
              {allBoards.map((board) => (
                <DropdownMenuItem
                  key={board.id}
                  onClick={() => handleBoardSwitch(board.slug)}
                  className="gap-2"
                >
                  <MessageSquare className="h-4 w-4" />
                  <span className="flex-1 truncate">{board.name}</span>
                  {board.id === currentBoard.id && <Check className="h-4 w-4 text-primary" />}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <CreateBoardDialog workspaceId={workspaceId} />
      </div>
      <p className="text-sm text-muted-foreground">
        Configure your feedback board settings and preferences
      </p>
    </div>
  )
}
