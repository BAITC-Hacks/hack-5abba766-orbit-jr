import type { PoolConfig } from 'pg';

/** Keep passwords as fields for Compose; local development may still use a URL. */
export function databaseConnectionConfig(environment: NodeJS.ProcessEnv = process.env): PoolConfig {
  if (environment.DATABASE_URL) {
    // pg parses URL options after explicit PoolConfig fields. Refuse ambiguous
    // startup options so an isolated test/demo cannot silently use public.
    if (environment.DATABASE_SCHEMA && new URL(environment.DATABASE_URL).searchParams.has('options')) {
      throw new Error('DATABASE_URL options cannot be combined with DATABASE_SCHEMA; remove URL options to preserve schema isolation');
    }
    return { connectionString: environment.DATABASE_URL };
  }
  if (environment.PGHOST) return {
    host: environment.PGHOST,
    port: environment.PGPORT ? Number(environment.PGPORT) : 5432,
    user: environment.PGUSER,
    password: environment.PGPASSWORD,
    database: environment.PGDATABASE,
  };
  return { connectionString: 'postgresql://career_quest:career_quest_local@127.0.0.1:54329/career_quest' };
}
