import { requireTenantBySlug } from '@/lib/tenant'
import { Card, CardContent } from '@/components/ui/card'

export default async function RoadmapPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params
  await requireTenantBySlug(orgSlug)

  return (
    <main className="px-6 py-8">
      <div className="mb-6">
        <h2 className="text-lg font-medium text-foreground">Roadmap</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Plan and visualize your product roadmap
        </p>
      </div>

      <Card>
        <CardContent className="p-12 text-center">
          <p className="text-muted-foreground">Roadmap feature coming soon</p>
        </CardContent>
      </Card>
    </main>
  )
}
