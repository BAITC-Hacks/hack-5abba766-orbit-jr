import { migrate, pool, withTransaction } from './index';
import { sourceHash } from '../validation';
import { loadDataset } from '../validation/load-dataset';
import { insertEmployees, insertHistory } from '../services/data';
import { seedDemoAccounts } from '../auth';

export async function bootstrapDatabase(datasetDirectory?: string): Promise<{ seeded: boolean }> {
  await migrate();
  const existing = await pool.query('SELECT seed_complete FROM app_meta WHERE id=1');
  // Existing persistent state starts without re-reading, replacing, or requiring source files.
  if (existing.rows[0]?.seed_complete) {
    await withTransaction(client => seedDemoAccounts(client), { bootstrap: true });
    return { seeded: false };
  }
  const snapshot = await loadDataset(datasetDirectory);
  return withTransaction(async client => {
    await client.query('SELECT pg_advisory_xact_lock(734119013)');
    const check = await client.query('SELECT seed_complete FROM app_meta WHERE id=1');
    if (check.rows[0]?.seed_complete) return { seeded: false };
    await client.query('INSERT INTO app_meta(id,as_of_date,dataset_revision,global_revision,seed_complete,source_fingerprint,proficiency_scale) VALUES(1,$1,1,1,false,$2,$3::jsonb)', [snapshot.as_of_date, sourceHash(snapshot), JSON.stringify(snapshot.proficiency_scale)]);
    await client.query("INSERT INTO skills(skill_id,source) SELECT x->>'skill_id',x FROM jsonb_array_elements($1::jsonb) x", [JSON.stringify(snapshot.skills)]);
    await client.query("INSERT INTO role_profiles(role,grade,source) SELECT x->>'role',x->>'grade',x FROM jsonb_array_elements($1::jsonb) x", [JSON.stringify(snapshot.role_profiles)]);
    await client.query("INSERT INTO events(event_id,source) SELECT x->>'event_id',x FROM jsonb_array_elements($1::jsonb) x", [JSON.stringify(snapshot.events)]);
    await insertEmployees(client, snapshot.employees);
    await insertHistory(client, snapshot.history);
    await seedDemoAccounts(client);
    await client.query('UPDATE app_meta SET seed_complete=true WHERE id=1');
    return { seeded: true };
  }, { bootstrap: true });
}
