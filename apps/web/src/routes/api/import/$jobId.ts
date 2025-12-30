import { createFileRoute } from '@tanstack/react-router'
import { validateApiWorkspaceAccess } from '@/lib/workspace'
import { getJobAdapter } from '@quackback/jobs'

export const Route = createFileRoute('/api/import/$jobId')({
  server: {
    handlers: {
      /**
       * GET /api/import/[jobId]
       * Get import job status
       */
      GET: async ({ params }) => {
        try {
          // Validate workspace access
          const validation = await validateApiWorkspaceAccess()
          if (!validation.success) {
            return Response.json({ error: validation.error }, { status: validation.status })
          }

          const { jobId } = params

          if (!jobId) {
            return Response.json({ error: 'Job ID is required' }, { status: 400 })
          }

          // Validate job ID format (format: import-{timestamp})
          if (!jobId.startsWith('import-')) {
            return Response.json({ error: 'Invalid job ID format' }, { status: 400 })
          }

          // Get job status via adapter
          const jobAdapter = getJobAdapter()
          const status = await jobAdapter.getImportJobStatus(jobId)

          if (!status) {
            return Response.json({ error: 'Job not found' }, { status: 404 })
          }

          return Response.json(status)
        } catch (error) {
          console.error('Error fetching job status:', error)
          return Response.json({ error: 'Internal server error' }, { status: 500 })
        }
      },
    },
  },
})
