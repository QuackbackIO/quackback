import { requireTenant } from '@/lib/tenant'

export default async function RoadmapPage() {
  await requireTenant()

  return (
    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-6">
        <h2 className="text-lg font-medium text-foreground">Roadmap</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Plan and visualize your product roadmap
        </p>
      </div>

      <div className="rounded-lg border border-border bg-card p-12 text-center">
        <p className="text-muted-foreground">Roadmap feature coming soon</p>
      </div>
    </main>
  )
}
