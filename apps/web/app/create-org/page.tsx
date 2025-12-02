import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth/server'
import { CreateOrgForm } from './create-org-form'

export default async function CreateOrgPage() {
  const session = await getSession()

  if (!session?.user) {
    redirect('/login')
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4 py-12 dark:bg-gray-900 sm:px-6 lg:px-8">
      <div className="w-full max-w-md space-y-8">
        <div className="text-center">
          <h2 className="mt-6 text-3xl font-bold tracking-tight text-gray-900 dark:text-white">
            Create your organization
          </h2>
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
            Set up your organization to start collecting feedback
          </p>
        </div>

        <CreateOrgForm />
      </div>
    </div>
  )
}
