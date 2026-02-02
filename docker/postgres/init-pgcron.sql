-- Initialize extensions
-- This runs after the database is created

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS vector;

-- Grant usage to postgres user
GRANT USAGE ON SCHEMA cron TO postgres;

-- Create catalog database for tenant-per-db architecture
CREATE DATABASE catalog;
