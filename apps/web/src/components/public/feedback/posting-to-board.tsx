import { useIntl, FormattedMessage } from 'react-intl'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { BoardSettings } from '@/lib/shared/db-types'

interface BoardOption {
  id: string
  name: string
  slug: string
  settings?: BoardSettings
}

export function PostingToBoard({
  boards,
  selectedBoardId,
  locked,
  onSelect,
}: {
  boards: BoardOption[]
  selectedBoardId: string
  locked: boolean
  onSelect: (id: string) => void
}) {
  const intl = useIntl()
  const selectedBoard = boards.find((b) => b.id === selectedBoardId)

  return (
    <div
      className="flex items-center px-4 sm:px-5 pt-3 pb-1"
      aria-label={intl.formatMessage(
        {
          id: 'portal.feedback.header.postingToBoard',
          defaultMessage: 'Posting to {board}',
        },
        { board: selectedBoard?.name ?? '' }
      )}
    >
      <span className="text-xs text-muted-foreground me-1">
        <FormattedMessage id="portal.feedback.header.postingTo" defaultMessage="Posting to" />
      </span>
      {locked ? (
        <span className="text-xs font-medium text-foreground">{selectedBoard?.name}</span>
      ) : (
        <Select value={selectedBoardId} onValueChange={onSelect}>
          <SelectTrigger
            size="xs"
            className="border-0 bg-transparent shadow-none font-medium text-foreground hover:text-foreground/80 focus-visible:ring-0"
          >
            <SelectValue
              placeholder={intl.formatMessage({
                id: 'portal.feedback.header.selectBoard',
                defaultMessage: 'Select a board',
              })}
            />
          </SelectTrigger>
          <SelectContent align="start">
            {boards.map((board) => (
              <SelectItem key={board.id} value={board.id} className="py-1">
                {board.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  )
}
