/**
 * Platform archive/close functions for cascading post deletes.
 *
 * Each function closes or archives a linked issue in an external tracker.
 * All functions handle errors gracefully -- failures are warnings, not blockers.
 */

// ============================================================================
// Types
// ============================================================================

export interface ArchiveResult {
  success: boolean
  /** 'closed' or 'archived' depending on platform semantics */
  action?: 'closed' | 'archived'
  error?: string
}

export interface ArchiveContext {
  externalId: string
  externalUrl?: string | null
  accessToken: string
  integrationConfig: Record<string, unknown>
}

// ============================================================================
// Registry
// ============================================================================

const archiveFns: Record<string, (ctx: ArchiveContext) => Promise<ArchiveResult>> = {
  linear: archiveLinearIssue,
  github: closeGitHubIssue,
  jira: closeJiraIssue,
  gitlab: closeGitLabIssue,
  clickup: closeClickUpTask,
  asana: completeAsanaTask,
  shortcut: archiveShortcutStory,
  azure_devops: closeAzureDevOpsWorkItem,
  trello: archiveTrelloCard,
  notion: archiveNotionPage,
  monday: archiveMondayItem,
}

/**
 * Archive or close a linked external issue.
 * Returns a result indicating success or failure -- never throws.
 */
export async function archiveExternalIssue(
  integrationType: string,
  ctx: ArchiveContext
): Promise<ArchiveResult> {
  const fn = archiveFns[integrationType]
  if (!fn) {
    return { success: false, error: `Unsupported integration type: ${integrationType}` }
  }
  try {
    return await fn(ctx)
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Unknown error',
    }
  }
}

// ============================================================================
// Platform Functions
// ============================================================================

const LINEAR_API = 'https://api.linear.app/graphql'

async function archiveLinearIssue(ctx: ArchiveContext): Promise<ArchiveResult> {
  const response = await fetch(LINEAR_API, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${ctx.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query: `mutation { issueArchive(id: "${ctx.externalId}") { success } }`,
    }),
  })

  if (response.status === 401) return { success: false, error: 'Auth expired' }
  if (response.status === 404) return { success: true, action: 'archived' } // already gone

  const json = (await response.json()) as {
    data?: { issueArchive?: { success: boolean } }
    errors?: Array<{ message: string }>
  }
  if (json.errors?.length) {
    return { success: false, error: json.errors[0].message }
  }
  return { success: true, action: 'archived' }
}

const GITHUB_API = 'https://api.github.com'

async function closeGitHubIssue(ctx: ArchiveContext): Promise<ArchiveResult> {
  // externalId is the issue number, externalUrl contains owner/repo info
  const ownerRepo = extractGitHubOwnerRepo(ctx.externalUrl)
  if (!ownerRepo) return { success: false, error: 'Cannot determine repo from external URL' }

  const response = await fetch(`${GITHUB_API}/repos/${ownerRepo}/issues/${ctx.externalId}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${ctx.accessToken}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'quackback',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    body: JSON.stringify({ state: 'closed' }),
  })

  if (response.status === 401) return { success: false, error: 'Auth expired' }
  if (response.status === 404) return { success: true, action: 'closed' } // already gone
  if (response.status === 422) return { success: true, action: 'closed' } // already closed
  if (!response.ok) {
    const text = await response.text()
    return { success: false, error: `GitHub API ${response.status}: ${text.slice(0, 200)}` }
  }
  return { success: true, action: 'closed' }
}

function extractGitHubOwnerRepo(url?: string | null): string | null {
  if (!url) return null
  const match = url.match(/github\.com\/([^/]+\/[^/]+)\/issues/)
  return match?.[1] ?? null
}

async function closeJiraIssue(ctx: ArchiveContext): Promise<ArchiveResult> {
  const cloudId = ctx.integrationConfig.cloudId as string
  if (!cloudId) return { success: false, error: 'Missing Jira cloudId' }

  const baseUrl = `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3`
  const headers = {
    Authorization: `Bearer ${ctx.accessToken}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  }

  // Step 1: Get available transitions
  const transRes = await fetch(`${baseUrl}/issue/${ctx.externalId}/transitions`, { headers })
  if (transRes.status === 401) return { success: false, error: 'Auth expired' }
  if (transRes.status === 404) return { success: true, action: 'closed' }
  if (!transRes.ok) {
    return { success: false, error: `Jira transitions API: ${transRes.status}` }
  }

  const transData = (await transRes.json()) as {
    transitions: Array<{ id: string; name: string; to: { statusCategory: { key: string } } }>
  }

  // Step 2: Find a terminal transition (Done category)
  const terminal = transData.transitions.find((t) => t.to.statusCategory.key === 'done')
  if (!terminal) {
    return { success: false, error: 'No terminal transition found (Done/Closed)' }
  }

  // Step 3: Execute the transition
  const execRes = await fetch(`${baseUrl}/issue/${ctx.externalId}/transitions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ transition: { id: terminal.id } }),
  })

  if (!execRes.ok) {
    return { success: false, error: `Jira transition failed: ${execRes.status}` }
  }
  return { success: true, action: 'closed' }
}

const GITLAB_API = 'https://gitlab.com/api/v4'

async function closeGitLabIssue(ctx: ArchiveContext): Promise<ArchiveResult> {
  // externalId is the issue iid; we need the project path from the URL
  const projectId = extractGitLabProjectId(ctx.externalUrl)
  if (!projectId) return { success: false, error: 'Cannot determine project from external URL' }

  const response = await fetch(
    `${GITLAB_API}/projects/${encodeURIComponent(projectId)}/issues/${ctx.externalId}`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${ctx.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ state_event: 'close' }),
    }
  )

  if (response.status === 401) return { success: false, error: 'Auth expired' }
  if (response.status === 404) return { success: true, action: 'closed' }
  if (!response.ok) {
    const text = await response.text()
    return { success: false, error: `GitLab API ${response.status}: ${text.slice(0, 200)}` }
  }
  return { success: true, action: 'closed' }
}

function extractGitLabProjectId(url?: string | null): string | null {
  if (!url) return null
  // GitLab URLs: https://gitlab.com/group/project/-/issues/123
  const match = url.match(/gitlab\.com\/(.+?)\/-\/issues/)
  return match?.[1] ?? null
}

const CLICKUP_API = 'https://api.clickup.com/api/v2'

async function closeClickUpTask(ctx: ArchiveContext): Promise<ArchiveResult> {
  const response = await fetch(`${CLICKUP_API}/task/${ctx.externalId}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${ctx.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ status: 'closed' }),
  })

  if (response.status === 401) return { success: false, error: 'Auth expired' }
  if (response.status === 404) return { success: true, action: 'closed' }
  if (!response.ok) {
    const text = await response.text()
    return { success: false, error: `ClickUp API ${response.status}: ${text.slice(0, 200)}` }
  }
  return { success: true, action: 'closed' }
}

const ASANA_API = 'https://app.asana.com/api/1.0'

async function completeAsanaTask(ctx: ArchiveContext): Promise<ArchiveResult> {
  const response = await fetch(`${ASANA_API}/tasks/${ctx.externalId}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${ctx.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ data: { completed: true } }),
  })

  if (response.status === 401) return { success: false, error: 'Auth expired' }
  if (response.status === 404) return { success: true, action: 'closed' }
  if (!response.ok) {
    const text = await response.text()
    return { success: false, error: `Asana API ${response.status}: ${text.slice(0, 200)}` }
  }
  return { success: true, action: 'closed' }
}

const SHORTCUT_API = 'https://api.app.shortcut.com/api/v3'

async function archiveShortcutStory(ctx: ArchiveContext): Promise<ArchiveResult> {
  const response = await fetch(`${SHORTCUT_API}/stories/${ctx.externalId}`, {
    method: 'PUT',
    headers: {
      'Shortcut-Token': ctx.accessToken,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ archived: true }),
  })

  if (response.status === 401) return { success: false, error: 'Auth expired' }
  if (response.status === 404) return { success: true, action: 'archived' }
  if (!response.ok) {
    const text = await response.text()
    return { success: false, error: `Shortcut API ${response.status}: ${text.slice(0, 200)}` }
  }
  return { success: true, action: 'archived' }
}

async function closeAzureDevOpsWorkItem(ctx: ArchiveContext): Promise<ArchiveResult> {
  const orgName = ctx.integrationConfig.organizationName as string
  if (!orgName) return { success: false, error: 'Missing Azure DevOps organizationName' }

  const pat = ctx.accessToken
  const encoded = Buffer.from(`:${pat}`).toString('base64')

  // We need the org URL to construct the API path
  const orgUrl =
    (ctx.integrationConfig.organizationUrl as string) || `https://dev.azure.com/${orgName}`

  const response = await fetch(`${orgUrl}/_apis/wit/workitems/${ctx.externalId}?api-version=7.1`, {
    method: 'PATCH',
    headers: {
      Authorization: `Basic ${encoded}`,
      'Content-Type': 'application/json-patch+json',
      Accept: 'application/json',
    },
    body: JSON.stringify([{ op: 'add', path: '/fields/System.State', value: 'Closed' }]),
  })

  if (response.status === 401) return { success: false, error: 'Auth expired' }
  if (response.status === 404) return { success: true, action: 'closed' }
  if (!response.ok) {
    const text = await response.text()
    return { success: false, error: `Azure DevOps API ${response.status}: ${text.slice(0, 200)}` }
  }
  return { success: true, action: 'closed' }
}

const TRELLO_API = 'https://api.trello.com/1'

async function archiveTrelloCard(ctx: ArchiveContext): Promise<ArchiveResult> {
  const apiKey = ctx.integrationConfig.apiKey as string
  if (!apiKey) return { success: false, error: 'Missing Trello API key' }

  const params = new URLSearchParams({
    closed: 'true',
    key: apiKey,
    token: ctx.accessToken,
  })

  const response = await fetch(`${TRELLO_API}/cards/${ctx.externalId}?${params}`, {
    method: 'PUT',
  })

  if (response.status === 401) return { success: false, error: 'Auth expired' }
  if (response.status === 404) return { success: true, action: 'archived' }
  if (!response.ok) {
    const text = await response.text()
    return { success: false, error: `Trello API ${response.status}: ${text.slice(0, 200)}` }
  }
  return { success: true, action: 'archived' }
}

const NOTION_API = 'https://api.notion.com/v1'
const NOTION_VERSION = '2022-06-28'

async function archiveNotionPage(ctx: ArchiveContext): Promise<ArchiveResult> {
  const response = await fetch(`${NOTION_API}/pages/${ctx.externalId}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${ctx.accessToken}`,
      'Content-Type': 'application/json',
      'Notion-Version': NOTION_VERSION,
    },
    body: JSON.stringify({ archived: true }),
  })

  if (response.status === 401) return { success: false, error: 'Auth expired' }
  if (response.status === 404) return { success: true, action: 'archived' }
  if (!response.ok) {
    const text = await response.text()
    return { success: false, error: `Notion API ${response.status}: ${text.slice(0, 200)}` }
  }
  return { success: true, action: 'archived' }
}

const MONDAY_API = 'https://api.monday.com/v2'

async function archiveMondayItem(ctx: ArchiveContext): Promise<ArchiveResult> {
  const response = await fetch(MONDAY_API, {
    method: 'POST',
    headers: {
      Authorization: ctx.accessToken, // Monday uses bare token, no "Bearer" prefix
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query: `mutation { archive_item(item_id: ${ctx.externalId}) { id } }`,
    }),
  })

  if (response.status === 401) return { success: false, error: 'Auth expired' }
  if (response.status === 404) return { success: true, action: 'archived' }

  const json = (await response.json()) as {
    data?: { archive_item?: { id: string } }
    errors?: Array<{ message: string }>
  }
  if (json.errors?.length) {
    return { success: false, error: json.errors[0].message }
  }
  return { success: true, action: 'archived' }
}
