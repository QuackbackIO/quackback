import {
  ChevronDownIcon,
  CheckIcon,
  ChatBubbleLeftIcon,
  Squares2X2Icon,
} from '@heroicons/react/24/solid'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { PageHeader } from '@/components/shared/page-header'
import { CreateBoardDialog } from './create-board-dialog'
import { useBoardSelection } from './use-board-selection'

interface Board {
  id: string
  name: string
  slug: string
}

interface BoardSettingsHeaderProps {
  currentBoard: Board
  allBoards: Board[]
}

export function BoardSettingsHeader({ currentBoard, allBoards }: BoardSettingsHeaderProps) {
  const { setSelectedBoard } = useBoardSelection()

  return (
    <PageHeader
      icon={Squares2X2Icon}
      title="Board Settings"
      description="Configure your feedback board settings and preferences"
      action={
        <div className="flex shrink-0 items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="min-w-0 gap-2" data-testid="board-switcher">
                <ChatBubbleLeftIcon className="h-4 w-4 shrink-0" />
                <span className="truncate">{currentBoard.name}</span>
                <ChevronDownIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56">
              {allBoards.map((board) => (
                <DropdownMenuItem
                  key={board.id}
                  onClick={() => setSelectedBoard(board.slug)}
                  className="gap-2"
                >
                  <ChatBubbleLeftIcon className="h-4 w-4" />
                  <span className="flex-1 truncate">{board.name}</span>
                  {board.id === currentBoard.id && <CheckIcon className="h-4 w-4 text-primary" />}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <CreateBoardDialog />
        </div>
      }
    />
  )
}
