import { bootstrapDatabase } from '../src/db/bootstrap';
import { closePools } from '../src/db';
try {
  const { seeded } = await bootstrapDatabase();
  console.log(seeded ? 'PostgreSQL migrations, dataset and demo accounts initialized.' : 'PostgreSQL ready; persistent data preserved.');
} catch (error) {
  console.error('Backend bootstrap failed:', error instanceof Error ? error.message : 'Unknown failure');
  if (error && typeof error === 'object' && 'details' in error) console.error(JSON.stringify(error.details));
  process.exitCode = 1;
} finally { await closePools(); }
