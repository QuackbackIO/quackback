import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'

const connectionString = process.env.DATABASE_URL!

// For query purposes
const queryClient = postgres(connectionString)
export const db = drizzle(queryClient, { schema })

// For migrations (if needed programmatically)
const migrationClient = postgres(connectionString, { max: 1 })
export const migrationDb = drizzle(migrationClient)

export type Database = typeof db
