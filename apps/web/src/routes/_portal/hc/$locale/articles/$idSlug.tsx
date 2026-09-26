import { createFileRoute, Outlet } from '@tanstack/react-router'
import { HelpCenterHero } from '@/components/help-center/help-center-hero'
import { HelpCenterHeroSearch } from '@/components/help-center/help-center-search'
import { useWorkspaceSettings } from '@/lib/client/hooks/use-root-context'

export const Route = createFileRoute('/_portal/hc/$locale/articles/$idSlug')({
  component: ArticleLayout,
})

function ArticleLayout() {
  const { locale } = Route.useParams()
  const settings = useWorkspaceSettings()
  const askAiEnabled = !!settings?.featureFlags?.helpCenter
  return (
    <>
      <HelpCenterHero variant="compact">
        <HelpCenterHeroSearch locale={locale} askAiEnabled={askAiEnabled} />
      </HelpCenterHero>
      <div className="mx-auto max-w-7xl">
        <Outlet />
      </div>
    </>
  )
}
