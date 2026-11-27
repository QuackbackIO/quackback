/**
 * The confirmation before the main language changes, with what the change
 * does to the help center, counted by the server: the articles and
 * collections that swap to their versions in the new language, the ones
 * relabelled, and the ones that stay in their own language. The change waits
 * for the counts, and a failed count can be tried again.
 */
import { FormattedMessage, useIntl } from 'react-intl'
import { useQuery } from '@tanstack/react-query'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import { previewMainLanguageChangeFn } from '@/lib/server/functions/language-settings'
import type { SupportedLocale } from '@/lib/shared/i18n'
import { useLanguageNames } from './use-language-name'

type Counts = Awaited<ReturnType<typeof previewMainLanguageChangeFn>>

/**
 * The articles and collections that swap to their version in the new
 * language. A sentence names only the kinds that have any, so it never reads
 * "0 collections".
 */
function SwapSentence({ counts, language }: { counts: Counts; language: string }) {
  const articles = counts.swappedArticles
  const collections = counts.swappedCollections
  if (articles > 0 && collections > 0) {
    return (
      <p>
        <FormattedMessage
          id="admin.settings.language.confirm.swap"
          defaultMessage="{articles, plural, one {# article} other {# articles}} and {collections, plural, one {# collection} other {# collections}} have a {language} version, which becomes their main text. Their current text becomes a translation, so nothing is lost."
          values={{ articles, collections, language }}
        />
      </p>
    )
  }
  if (articles > 0) {
    return (
      <p>
        <FormattedMessage
          id="admin.settings.language.confirm.swapArticles"
          defaultMessage="{count, plural, one {# article has a {language} version, which becomes its main text. Its current text becomes a translation, so nothing is lost.} other {# articles have a {language} version, which becomes their main text. Their current text becomes a translation, so nothing is lost.}}"
          values={{ count: articles, language }}
        />
      </p>
    )
  }
  if (collections > 0) {
    return (
      <p>
        <FormattedMessage
          id="admin.settings.language.confirm.swapCollections"
          defaultMessage="{count, plural, one {# collection has a {language} version, which becomes its main text. Its current text becomes a translation, so nothing is lost.} other {# collections have a {language} version, which becomes their main text. Their current text becomes a translation, so nothing is lost.}}"
          values={{ count: collections, language }}
        />
      </p>
    )
  }
  return null
}

/**
 * The articles and collections relabelled with the new language. After a
 * swap sentence it says "with no X version"; alone it says "Your ...". Like
 * the swap sentence, it names only the kinds that have any.
 */
function RelabelSentence({ counts, language }: { counts: Counts; language: string }) {
  const articles = counts.relabelledArticles
  const collections = counts.relabelledCollections
  if (articles + collections === 0) return null
  const rest = counts.swappedArticles + counts.swappedCollections > 0
  if (articles > 0 && collections > 0) {
    return (
      <p>
        {rest ? (
          <FormattedMessage
            id="admin.settings.language.confirm.relabelRest"
            defaultMessage="{articles, plural, one {# article} other {# articles}} and {collections, plural, one {# collection} other {# collections}} with no {language} version will be marked as {language}. Nothing is rewritten or translated."
            values={{ articles, collections, language }}
          />
        ) : (
          <FormattedMessage
            id="admin.settings.language.confirm.relabel"
            defaultMessage="Your {articles, plural, one {# article} other {# articles}} and {collections, plural, one {# collection} other {# collections}} will be marked as {language}. Nothing is rewritten or translated."
            values={{ articles, collections, language }}
          />
        )}
      </p>
    )
  }
  if (articles > 0) {
    return (
      <p>
        {rest ? (
          <FormattedMessage
            id="admin.settings.language.confirm.relabelRestArticles"
            defaultMessage="{count, plural, one {# article} other {# articles}} with no {language} version will be marked as {language}. Nothing is rewritten or translated."
            values={{ count: articles, language }}
          />
        ) : (
          <FormattedMessage
            id="admin.settings.language.confirm.relabelArticles"
            defaultMessage="Your {count, plural, one {# article} other {# articles}} will be marked as {language}. Nothing is rewritten or translated."
            values={{ count: articles, language }}
          />
        )}
      </p>
    )
  }
  return (
    <p>
      {rest ? (
        <FormattedMessage
          id="admin.settings.language.confirm.relabelRestCollections"
          defaultMessage="{count, plural, one {# collection} other {# collections}} with no {language} version will be marked as {language}. Nothing is rewritten or translated."
          values={{ count: collections, language }}
        />
      ) : (
        <FormattedMessage
          id="admin.settings.language.confirm.relabelCollections"
          defaultMessage="Your {count, plural, one {# collection} other {# collections}} will be marked as {language}. Nothing is rewritten or translated."
          values={{ count: collections, language }}
        />
      )}
    </p>
  )
}

export default function MainLanguageConfirm({
  to,
  onClose,
  onConfirm,
}: {
  to: SupportedLocale
  onClose: () => void
  onConfirm: (mainLanguage: SupportedLocale) => Promise<void>
}) {
  const intl = useIntl()
  const { name } = useLanguageNames()
  const preview = useQuery({
    queryKey: ['settings', 'mainLanguagePreview', to],
    queryFn: () => previewMainLanguageChangeFn({ data: { mainLanguage: to } }),
    staleTime: 0,
    gcTime: 0,
  })
  const language = name(to)
  const counts = preview.data

  return (
    <ConfirmDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      title={intl.formatMessage(
        {
          id: 'admin.settings.language.confirm.title',
          defaultMessage: 'Switch your main language to {language}?',
        },
        { language }
      )}
      description={
        <div className="space-y-3" data-testid="main-language-confirm">
          {preview.isError && (
            <p role="alert" className="text-destructive">
              <FormattedMessage
                id="admin.settings.language.confirm.previewFailed"
                defaultMessage="We could not check what this changes."
              />{' '}
              <button
                type="button"
                className="font-medium underline underline-offset-2"
                onClick={() => void preview.refetch()}
              >
                <FormattedMessage
                  id="admin.settings.language.confirm.retry"
                  defaultMessage="Try again"
                />
              </button>
            </p>
          )}
          {counts && <SwapSentence counts={counts} language={language} />}
          {counts && <RelabelSentence counts={counts} language={language} />}
          {counts && counts.keptArticles > 0 && (
            <p>
              <FormattedMessage
                id="admin.settings.language.confirm.kept"
                defaultMessage="{count, plural, one {# article has no published {language} version yet and stays as it is.} other {# articles have no published {language} version yet and stay as they are.}}"
                values={{ count: counts.keptArticles, language }}
              />
            </p>
          )}
          {counts && counts.keptCollections > 0 && (
            <p>
              <FormattedMessage
                id="admin.settings.language.confirm.keptCollections"
                defaultMessage="{count, plural, one {# collection has no {language} name yet and stays as it is.} other {# collections have no {language} name yet and stay as they are.}}"
                values={{ count: counts.keptCollections, language }}
              />
            </p>
          )}
          <ul className="list-disc space-y-1 ps-5">
            <li>
              <FormattedMessage
                id="admin.settings.language.confirm.visitors"
                defaultMessage="Visitors whose language you have not added see your {language} articles."
                values={{ language }}
              />
            </li>
            <li>
              <FormattedMessage
                id="admin.settings.language.confirm.search"
                defaultMessage="Help center search understands {language} words."
                values={{ language }}
              />
            </li>
          </ul>
        </div>
      }
      cancelLabel={intl.formatMessage({ id: 'common.cancel', defaultMessage: 'Cancel' })}
      confirmLabel={intl.formatMessage(
        { id: 'admin.settings.language.confirm.action', defaultMessage: 'Switch to {language}' },
        { language }
      )}
      confirmDisabled={!counts}
      onConfirm={() => onConfirm(to)}
    />
  )
}
