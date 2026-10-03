export interface AskEntityResult {
  id: string
  kind: 'post' | 'article' | 'changelog' | 'conversation' | 'ticket'
  title: string
  href: string
}
