import { FormattedMessage } from 'react-intl'
import { Link } from '@tanstack/react-router'

interface ReadOnlyBoardNoteProps {
  /** A board to post to instead, when there is one. */
  shareBoard?: { name: string; slug: string } | null
}

/**
 * Stands in for the composer on a board that shows its posts and takes none.
 * Quiet on purpose, and it never says why.
 */
export function ReadOnlyBoardNote({ shareBoard }: ReadOnlyBoardNoteProps): React.ReactElement {
  return (
    <p
      data-testid="read-only-board-note"
      className="mb-5 rounded-lg border border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground"
    >
      <FormattedMessage
        id="portal.feedback.readOnly"
        defaultMessage="This board isn't taking new feedback right now."
      />
      {shareBoard && (
        <>
          {' '}
          <FormattedMessage
            id="portal.feedback.readOnlyShare"
            defaultMessage="Share it in {board}."
            values={{
              board: (
                <Link
                  to="/"
                  search={{ board: shareBoard.slug }}
                  className="font-medium text-foreground hover:underline"
                >
                  {shareBoard.name}
                </Link>
              ),
            }}
          />
        </>
      )}
    </p>
  )
}
