import { redirect } from 'next/navigation'
import { requireTenant } from '@/lib/tenant'
import { db, boards, eq } from '@quackback/db'
import { MessageSquare, Plus, ExternalLink } from 'lucide-react'
import Link from 'next/link'

export default async function AdminPage() {
  const { organization, user } = await requireTenant()

  // Check if org has boards - if not, redirect to onboarding
  const orgBoards = await db.query.boards.findMany({
    where: eq(boards.organizationId, organization.id),
    orderBy: (boards, { desc }) => [desc(boards.createdAt)],
  })

  if (orgBoards.length === 0) {
    redirect('/onboarding')
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <header className="border-b border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
          <div>
            <h1 className="text-xl font-semibold text-gray-900 dark:text-white">
              {organization.name}
            </h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">Admin</p>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-sm text-gray-600 dark:text-gray-400">{user.email}</span>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-lg font-medium text-gray-900 dark:text-white">Feedback Boards</h2>
          <Link
            href="/boards/new"
            className="inline-flex items-center gap-2 rounded-md bg-black px-4 py-2 text-sm text-white hover:bg-gray-800 dark:bg-white dark:text-black dark:hover:bg-gray-200"
          >
            <Plus className="h-4 w-4" />
            New Board
          </Link>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {orgBoards.map((board) => (
            <Link
              key={board.id}
              href={`/boards/${board.slug}`}
              className="group rounded-lg border border-gray-200 bg-white p-5 transition-colors hover:border-gray-300 dark:border-gray-700 dark:bg-gray-800 dark:hover:border-gray-600"
            >
              <div className="flex items-start justify-between">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-100 dark:bg-blue-900/30">
                  <MessageSquare className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                </div>
                <ExternalLink className="h-4 w-4 text-gray-400 opacity-0 transition-opacity group-hover:opacity-100" />
              </div>
              <h3 className="mt-4 font-medium text-gray-900 dark:text-white">{board.name}</h3>
              {board.description && (
                <p className="mt-1 text-sm text-gray-500 dark:text-gray-400 line-clamp-2">
                  {board.description}
                </p>
              )}
              <div className="mt-4 flex items-center gap-2">
                <span
                  className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                    board.isPublic
                      ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                      : 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300'
                  }`}
                >
                  {board.isPublic ? 'Public' : 'Private'}
                </span>
              </div>
            </Link>
          ))}
        </div>
      </main>
    </div>
  )
}
