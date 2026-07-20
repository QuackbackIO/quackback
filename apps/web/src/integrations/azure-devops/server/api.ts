/**
 * Azure DevOps API wrapper.
 * Uses Personal Access Token (PAT) with Basic auth.
 */

function authHeader(pat: string): string {
  const encoded = Buffer.from(`:${pat}`).toString('base64')
  return `Basic ${encoded}`
}

async function azureDevOpsApi(
  method: string,
  url: string,
  pat: string,
  body?: unknown
): Promise<Response> {
  const headers: Record<string, string> = {
    Authorization: authHeader(pat),
    Accept: 'application/json',
  }

  if (body) {
    // Work item creation uses JSON Patch format
    if (url.includes('workitems')) {
      headers['Content-Type'] = 'application/json-patch+json'
    } else {
      headers['Content-Type'] = 'application/json'
    }
  }

  const response = await fetch(url, {
    method,
    headers,
    ...(body ? { body: JSON.stringify(body) } : {}),
  })

  if (!response.ok) {
    const status = response.status
    if (status === 401) throw Object.assign(new Error('Unauthorized'), { status })
    if (status === 403) throw Object.assign(new Error('Forbidden'), { status })
    if (status === 429) throw Object.assign(new Error('Rate limited'), { status })
    if (status >= 500) throw Object.assign(new Error(`Server error ${status}`), { status })
    throw Object.assign(new Error(`HTTP ${status}`), { status })
  }

  return response
}

export interface AzureDevOpsProject {
  id: string
  name: string
}

export interface AzureDevOpsWorkItemType {
  name: string
  description: string
}

export async function listProjects(
  pat: string,
  organization: string
): Promise<AzureDevOpsProject[]> {
  const url = `https://dev.azure.com/${encodeURIComponent(organization)}/_apis/projects?api-version=7.1`
  const response = await azureDevOpsApi('GET', url, pat)
  const data = (await response.json()) as { value: Array<{ id: string; name: string }> }
  return data.value.map((p) => ({ id: p.id, name: p.name }))
}

export async function listWorkItemTypes(
  pat: string,
  organization: string,
  project: string
): Promise<AzureDevOpsWorkItemType[]> {
  const url = `https://dev.azure.com/${encodeURIComponent(organization)}/${encodeURIComponent(project)}/_apis/wit/workitemtypes?api-version=7.1`
  const response = await azureDevOpsApi('GET', url, pat)
  const data = (await response.json()) as {
    value: Array<{ name: string; description: string }>
  }
  return data.value.map((t) => ({ name: t.name, description: t.description }))
}

export interface CreateWorkItemResult {
  id: number
  url: string
}

export async function createWorkItem(
  pat: string,
  organization: string,
  project: string,
  type: string,
  fields: { title: string; description: string }
): Promise<CreateWorkItemResult> {
  const url = `https://dev.azure.com/${encodeURIComponent(organization)}/${encodeURIComponent(project)}/_apis/wit/workitems/$${encodeURIComponent(type)}?api-version=7.1`

  const patchBody = [
    { op: 'add', path: '/fields/System.Title', value: fields.title },
    { op: 'add', path: '/fields/System.Description', value: fields.description },
  ]

  const response = await azureDevOpsApi('POST', url, pat, patchBody)
  const data = (await response.json()) as { id: number; _links: { html: { href: string } } }

  return {
    id: data.id,
    url: data._links.html.href,
  }
}
