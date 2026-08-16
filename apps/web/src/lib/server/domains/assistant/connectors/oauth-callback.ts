import { finishConnectorOAuth } from './oauth-provider'

export async function handleConnectorOAuthCallback(request: Request): Promise<Response> {
  return finishConnectorOAuth(request)
}
