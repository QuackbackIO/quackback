import { useQuery } from '@tanstack/react-query'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { InlineSpinner } from '@/components/admin/settings/inline-spinner'
import { getArticleTranslationChangesFn } from '@/lib/server/functions/help-center-article-languages'
import { lineDiff, type DiffLine } from '@/lib/shared/utils/line-diff'
import { cn } from '@/lib/shared/utils'
import type { SupportedLocale } from '@/lib/shared/i18n'
import { languageName } from './article-language-bar'

interface Text {
  title: string
  description: string | null
  content: string
}

const asLines = (t: Text) => [t.title, t.description ?? '', '', t.content].join('\n')

function Diff({ lines }: { lines: DiffLine[] }) {
  return (
    <pre className="max-h-[50vh] overflow-auto whitespace-pre-wrap rounded-md border border-border/50 bg-muted/20 p-3 text-xs leading-relaxed">
      {lines.map((line, i) => (
        <div
          key={i}
          data-kind={line.kind}
          className={cn(
            'px-1',
            line.kind === 'added' && 'bg-success/10 text-success',
            line.kind === 'removed' && 'bg-destructive/10 text-destructive line-through'
          )}
        >
          {line.kind === 'added' ? '+ ' : line.kind === 'removed' ? '- ' : '  '}
          {line.text || ' '}
        </div>
      ))}
    </pre>
  )
}

/**
 * "Show changes": what changed in the article since this translation was
 * made, and, when an AI update is waiting, how it differs from the live text.
 */
export function ArticleTranslationChangesDialog({
  articleId,
  locale,
  ownLocale,
  open,
  onOpenChange,
}: {
  articleId: string
  locale: string
  ownLocale: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const changes = useQuery({
    queryKey: ['help-center', 'article-translation-changes', articleId, locale],
    queryFn: () =>
      getArticleTranslationChangesFn({
        data: { articleId, locale: locale as SupportedLocale },
      }),
    enabled: open,
  })
  const data = changes.data
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Changes</DialogTitle>
        </DialogHeader>
        {!data ? (
          <div className="flex justify-center py-8">
            <InlineSpinner visible />
          </div>
        ) : (
          <div className="space-y-5">
            {data.update ? (
              <section className="space-y-2">
                <h3 className="text-sm font-medium">The AI update, compared with the live text</h3>
                <Diff lines={lineDiff(asLines(data.update.live), asLines(data.update.pending))} />
              </section>
            ) : null}
            <section className="space-y-2">
              <h3 className="text-sm font-medium">
                The {languageName(ownLocale)} article since this translation was made
              </h3>
              {data.source.before ? (
                <Diff lines={lineDiff(asLines(data.source.before), asLines(data.source.after))} />
              ) : (
                <p className="text-sm text-muted-foreground">
                  The earlier text is not on record for this translation.
                </p>
              )}
            </section>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
