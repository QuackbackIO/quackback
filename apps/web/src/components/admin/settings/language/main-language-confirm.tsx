/**
 * The confirmation before the main language changes, with what the change
 * does to the help center: the articles and collections relabelled, or
 * swapped with their versions in the new language, counted by the server.
 */
import { FormattedMessage, useIntl } from 'react-intl'
import { useQuery } from '@tanstack/react-query'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import { previewMainLanguageChangeFn } from '@/lib/server/functions/language-settings'
import type { SupportedLocale } from '@/lib/shared/i18n'
import { useLanguageNames } from './use-language-name'

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
          {counts?.swap ? (
            <>
              <p>
                <FormattedMessage
                  id="admin.settings.language.confirm.swap"
                  defaultMessage="{articles, plural, one {# article} other {# articles}} and {collections, plural, one {# collection} other {# collections}} have a {language} version, which becomes their main text. Their current text becomes a translation, so nothing is lost."
                  values={{ articles: counts.articles, collections: counts.collections, language }}
                />
              </p>
              {counts.keptArticles > 0 && (
                <p>
                  <FormattedMessage
                    id="admin.settings.language.confirm.kept"
                    defaultMessage="{count, plural, one {# article has no published {language} version yet and stays as it is.} other {# articles have no published {language} version yet and stay as they are.}}"
                    values={{ count: counts.keptArticles, language }}
                  />
                </p>
              )}
            </>
          ) : counts && counts.articles + counts.collections > 0 ? (
            <p>
              <FormattedMessage
                id="admin.settings.language.confirm.relabel"
                defaultMessage="Your {articles, plural, one {# article} other {# articles}} and {collections, plural, one {# collection} other {# collections}} will be marked as {language}. Nothing is rewritten or translated."
                values={{ articles: counts.articles, collections: counts.collections, language }}
              />
            </p>
          ) : null}
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
