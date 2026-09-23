CREATE TABLE app_meta (
  id integer PRIMARY KEY CHECK (id = 1),
  as_of_date text NOT NULL,
  dataset_revision integer NOT NULL CHECK (dataset_revision > 0),
  global_revision integer NOT NULL CHECK (global_revision > 0),
  seed_complete boolean NOT NULL DEFAULT false,
  source_fingerprint text NOT NULL,
  proficiency_scale jsonb NOT NULL
);
CREATE TABLE skills (skill_id text PRIMARY KEY, source jsonb NOT NULL);
CREATE TABLE role_profiles (role text NOT NULL, grade text NOT NULL, source jsonb NOT NULL, PRIMARY KEY (role, grade));
CREATE TABLE events (event_id text PRIMARY KEY, source jsonb NOT NULL);
CREATE TABLE employees (
  employee_id text PRIMARY KEY,
  source jsonb NOT NULL,
  source_hash text NOT NULL,
  employee_revision integer NOT NULL DEFAULT 1 CHECK (employee_revision > 0)
);
CREATE TABLE history_records (
  record_id text PRIMARY KEY,
  employee_id text NOT NULL REFERENCES employees(employee_id),
  event_id text NOT NULL REFERENCES events(event_id),
  date text NOT NULL,
  status text NOT NULL CHECK (status IN ('completed','in_progress','dropped','no_show','declined','overdue')),
  source jsonb NOT NULL,
  source_hash text NOT NULL
);
CREATE INDEX history_employee_date_idx ON history_records(employee_id,date,record_id);
CREATE INDEX history_event_status_idx ON history_records(event_id,status);
CREATE TABLE accounts (
  id text PRIMARY KEY,
  username text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  role text NOT NULL CHECK (role IN ('employee','hr')),
  employee_id text REFERENCES employees(employee_id),
  display_name text NOT NULL,
  CHECK (role <> 'employee' OR employee_id IS NOT NULL)
);
CREATE TABLE sessions (
  token_hash text PRIMARY KEY,
  account_id text NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL
);
CREATE INDEX sessions_expiry_idx ON sessions(expires_at);
CREATE TABLE goal_overrides (
  employee_id text PRIMARY KEY REFERENCES employees(employee_id),
  goal jsonb,
  actor_id text NOT NULL REFERENCES accounts(id),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE demo_completions (
  id text PRIMARY KEY,
  employee_id text NOT NULL REFERENCES employees(employee_id),
  event_id text NOT NULL REFERENCES events(event_id),
  participation_id text UNIQUE REFERENCES history_records(record_id),
  session_date text,
  occurrence_key text NOT NULL,
  applied_as_of text NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  sequence bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  actor_id text NOT NULL REFERENCES accounts(id),
  UNIQUE (employee_id,event_id,occurrence_key)
);
CREATE INDEX completions_employee_sequence_idx ON demo_completions(employee_id,sequence);
CREATE TABLE action_receipts (
  actor_id text NOT NULL REFERENCES accounts(id),
  operation text NOT NULL,
  idempotency_key text NOT NULL,
  request_hash text NOT NULL,
  result jsonb NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (actor_id,operation,idempotency_key)
);
CREATE TABLE import_batches (
  id text PRIMARY KEY,
  actor_id text NOT NULL REFERENCES accounts(id),
  fingerprint text NOT NULL,
  result jsonb NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE audit_records (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_id text NOT NULL REFERENCES accounts(id),
  operation text NOT NULL,
  target_employee_id text REFERENCES employees(employee_id),
  details jsonb NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
