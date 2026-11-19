import { FormattedMessage } from 'react-intl'

/**
 * Stands in for the composer on a board that shows its posts and takes none.
 * Quiet on purpose, and it never says why.
 */
export function ReadOnlyBoardNote(): React.ReactElement {
  return (
    <p
      data-testid="read-only-board-note"
      className="mb-5 rounded-lg border border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground"
    >
      <FormattedMessage
        id="portal.feedback.readOnly"
        defaultMessage="This board isn't taking new feedback right now."
      />
    </p>
  )
}
