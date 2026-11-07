import { createFileRoute, notFound } from '@tanstack/react-router'
import { AreaMessages } from '@/components/shared/area-messages'
import { StatusPageView } from '@/components/portal/status/status-page-view'
import { SupportPageView } from '@/components/portal/support/support-page-view'
import { HelpCenterLandingView } from '@/components/help-center/help-center-landing-view'
import { RoadmapPageView } from '@/components/public/roadmap-page'
import { FeedPage } from '@/components/public/feedback/feed-page'
import { ChangelogPage } from '@/components/portal/changelog/changelog-page'
import { SampleQueries } from '@/components/public/sample-queries'
import { getDesignerSampleFn } from '@/lib/server/functions/portal-designer'
import { isSamplePage } from '@/lib/shared/design/sample-pages'
import { DEFAULT_LOCALE, loadAreaMessages } from '@/lib/shared/i18n'

/**
 * A page drawn from sample content, for the designer's frame alone: a part
 * that is off, or one with nothing to show yet, styled before it has its
 * own. Every query the page asks is answered from the sample, never the
 * server. Anyone who may not change the portal's branding finds nothing here.
 */
export const Route = createFileRoute('/_portal/design-sample/$page')({
  loader: async ({ params, context }) => {
    if (!isSamplePage(params.page)) throw notFound()
    const answer = await getDesignerSampleFn({ data: { page: params.page } })
    if (!answer.ok) throw notFound()
    const { page } = answer.sample
    const locale = context.acceptLanguageLocale ?? DEFAULT_LOCALE
    const messages =
      page === 'status' || page === 'help'
        ? await loadAreaMessages(locale, page === 'status' ? 'statusPage' : 'helpCenter')
        : {}
    return { sample: answer.sample, messages }
  },
  head: () => ({
    meta: [{ title: 'Sample' }, { name: 'robots', content: 'noindex, nofollow' }],
  }),
  component: SamplePage,
})

function SamplePage() {
  const { sample, messages } = Route.useLoaderData()
  switch (sample.page) {
    case 'status':
      return (
        <AreaMessages area="statusPage" messages={messages}>
          <StatusPageView data={sample.status} sample />
        </AreaMessages>
      )
    case 'help':
      return (
        <AreaMessages area="helpCenter" messages={messages}>
          <HelpCenterLandingView
            categories={sample.help.categories}
            popularArticles={sample.help.popularArticles}
            helpCenterConfig={null}
            askAiEnabled={false}
          />
        </AreaMessages>
      )
    case 'support':
      // Drawn signed in, whoever looks: the list is only ever a visitor's own.
      return (
        <SupportPageView
          signedIn
          messenger
          conversations={sample.support.conversations}
          linkedTickets={sample.support.linkedTickets}
        />
      )
    case 'roadmap':
      return (
        <SampleQueries sample={sample}>
          <RoadmapPageView
            roadmaps={sample.roadmap.roadmaps}
            selectedId={sample.roadmap.roadmaps[0]?.id ?? null}
            isTeamMember={false}
          />
        </SampleQueries>
      )
    case 'feedback':
      return (
        <SampleQueries sample={sample}>
          <FeedPage />
        </SampleQueries>
      )
    case 'changelog':
      return (
        <SampleQueries sample={sample}>
          <ChangelogPage />
        </SampleQueries>
      )
  }
}
