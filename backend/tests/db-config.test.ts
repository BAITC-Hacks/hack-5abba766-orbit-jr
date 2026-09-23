import pg from 'pg';
import { describe, expect, it } from 'vitest';
import { databaseConnectionConfig } from '../src/db/config';

// Inspect pg's parsed configuration without opening a network connection.
function connection(environment: NodeJS.ProcessEnv) {
  return (new pg.Client(databaseConnectionConfig(environment)) as unknown as {
    connectionParameters: { host: string; port: number; user: string; password: string; database: string };
  }).connectionParameters;
}

describe('Database connection configuration', () => {
  it('rejects URL startup options that would override an isolated schema', () => {
    expect(() => databaseConnectionConfig({
      DATABASE_URL: 'postgresql://local:password@localhost/db?options=-c%20search_path%3Dpublic',
      DATABASE_SCHEMA: 'cq_demo_0123456789abcdef0123456789abcdef',
    })).toThrow('preserve schema isolation');
  });

  it('preserves explicit schema options in the effective pg connection', () => {
    const client = new pg.Client({ ...databaseConnectionConfig({
      DATABASE_URL: 'postgresql://local:password@localhost/db',
      DATABASE_SCHEMA: 'cq_demo_0123456789abcdef0123456789abcdef',
    }), options: '-c search_path=cq_demo_0123456789abcdef0123456789abcdef' });
    expect((client as unknown as { connectionParameters: { options: string } }).connectionParameters.options)
      .toBe('-c search_path=cq_demo_0123456789abcdef0123456789abcdef');
  });

  it.each(['demo#test', 'demo?test', 'demo/test', 'demo@:% test'])('preserves password characters: %s', password => {
    const parsed = connection({ PGHOST: 'db', PGPORT: '5432', PGUSER: 'career_quest', PGPASSWORD: password, PGDATABASE: 'career_quest' });
    expect(parsed.password).toBe(password);
    expect(parsed.host).toBe('db');
    expect(parsed.port).toBe(5432);
    expect(parsed.database).toBe('career_quest');
  });

  it('keeps an explicit local URL authoritative over PG fields', () => {
    const parsed = connection({ DATABASE_URL: 'postgresql://local:encoded%23password@localhost:5544/local_db', PGHOST: 'db', PGPASSWORD: 'ignored' });
    expect(parsed.host).toBe('localhost');
    expect(parsed.port).toBe(5544);
    expect(parsed.user).toBe('local');
    expect(parsed.password).toBe('encoded#password');
    expect(parsed.database).toBe('local_db');
  });

  it('retains the existing local default when neither configuration is supplied', () => {
    const parsed = connection({});
    expect(parsed.host).toBe('127.0.0.1');
    expect(parsed.port).toBe(54329);
    expect(parsed.user).toBe('career_quest');
    expect(parsed.database).toBe('career_quest');
  });
});
