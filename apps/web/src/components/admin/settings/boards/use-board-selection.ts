import { useNavigate } from '@tanstack/react-router'
import { Route } from '@/routes/admin/settings.boards.index'

export type BoardTab = 'general' | 'access' | 'import' | 'export'

interface BoardSelectionState {
  selectedBoardSlug: string | null
  selectedTab: BoardTab
  setSelectedBoard: (boardSlug: string | null, tab?: BoardTab) => void
  setSelectedTab: (tab: BoardTab) => void
}

export function useBoardSelection(): BoardSelectionState {
  const navigate = useNavigate()
  const { board, tab } = Route.useSearch()

  function setSelectedBoard(boardSlug: string | null, newTab?: BoardTab): void {
    void navigate({
      to: '/admin/settings/boards',
      search: {
        board: boardSlug ?? undefined,
        tab: newTab ?? undefined,
      },
      replace: true,
    })
  }

  function setSelectedTab(newTab: BoardTab): void {
    void navigate({
      to: '/admin/settings/boards',
      search: {
        board: board ?? undefined,
        tab: newTab === 'general' ? undefined : newTab,
      },
      replace: true,
    })
  }

  return {
    selectedBoardSlug: board ?? null,
    selectedTab: tab ?? 'general',
    setSelectedBoard,
    setSelectedTab,
  }
}
