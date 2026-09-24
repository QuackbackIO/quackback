/** Shared settings for the performance bench. */

export const BENCH_DATABASE_URL =
  process.env.PERF_DATABASE_URL ??
  'postgresql://postgres:password@localhost:5432/quackback_perf_bench'

export const BENCH_PORT = Number(process.env.PERF_PORT ?? 3190)

export const ADMIN = { email: 'demo@example.com', password: 'password' }
