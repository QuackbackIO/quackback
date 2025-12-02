import { Button } from '@/components/ui/button'

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-24">
      <h1 className="text-4xl font-bold">Quackback</h1>
      <p className="mt-4 text-muted-foreground">Open-source customer feedback platform</p>
      <Button className="mt-6">Get Started</Button>
    </main>
  )
}
