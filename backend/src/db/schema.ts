import { pgTable, text, integer, boolean, jsonb, timestamp, bigint, primaryKey, uniqueIndex, index } from 'drizzle-orm/pg-core';
import type { EmployeeSource, ParticipationSource, SkillDefinition, RoleProfile, EventView, CareerGoal, CatalogView } from '../types';
export const appMeta = pgTable('app_meta', {
  id: integer('id').primaryKey(), asOfDate: text('as_of_date').notNull(), datasetRevision: integer('dataset_revision').notNull(), globalRevision: integer('global_revision').notNull(),
  seedComplete: boolean('seed_complete').notNull().default(false), sourceFingerprint: text('source_fingerprint').notNull(), proficiencyScale: jsonb('proficiency_scale').$type<CatalogView['proficiency_scale']>().notNull(),
});
export const skills = pgTable('skills', { skillId: text('skill_id').primaryKey(), source: jsonb('source').$type<SkillDefinition>().notNull() });
export const roleProfiles = pgTable('role_profiles', { role: text('role').notNull(), grade: text('grade').notNull(), source: jsonb('source').$type<RoleProfile>().notNull() }, t => [primaryKey({ columns: [t.role, t.grade] })]);
export const events = pgTable('events', { eventId: text('event_id').primaryKey(), source: jsonb('source').$type<EventView>().notNull() });
export const employees = pgTable('employees', {
  employeeId: text('employee_id').primaryKey(), source: jsonb('source').$type<EmployeeSource>().notNull(), sourceHash: text('source_hash').notNull(), employeeRevision: integer('employee_revision').notNull().default(1),
});
export const historyRecords = pgTable('history_records', {
  recordId: text('record_id').primaryKey(), employeeId: text('employee_id').notNull().references(() => employees.employeeId), eventId: text('event_id').notNull().references(() => events.eventId),
  date: text('date').notNull(), status: text('status').notNull(), source: jsonb('source').$type<ParticipationSource>().notNull(), sourceHash: text('source_hash').notNull(),
}, t => [index('history_employee_date_idx').on(t.employeeId, t.date, t.recordId), index('history_event_status_idx').on(t.eventId, t.status)]);
export const accounts = pgTable('accounts', {
  id: text('id').primaryKey(), username: text('username').unique().notNull(), passwordHash: text('password_hash').notNull(), role: text('role').notNull(),
  employeeId: text('employee_id').references(() => employees.employeeId), displayName: text('display_name').notNull(),
});
export const sessions = pgTable('sessions', { tokenHash: text('token_hash').primaryKey(), accountId: text('account_id').notNull().references(() => accounts.id, { onDelete: 'cascade' }), expiresAt: timestamp('expires_at', { withTimezone: true }).notNull() }, t => [index('sessions_expiry_idx').on(t.expiresAt)]);
export const goalOverrides = pgTable('goal_overrides', {
  employeeId: text('employee_id').primaryKey().references(() => employees.employeeId), goal: jsonb('goal').$type<CareerGoal | null>(), actorId: text('actor_id').notNull().references(() => accounts.id), recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
});
export const demoCompletions = pgTable('demo_completions', {
  id: text('id').primaryKey(), employeeId: text('employee_id').notNull().references(() => employees.employeeId), eventId: text('event_id').notNull().references(() => events.eventId),
  participationId: text('participation_id').unique().references(() => historyRecords.recordId), sessionDate: text('session_date'), occurrenceKey: text('occurrence_key').notNull(), appliedAsOf: text('applied_as_of').notNull(),
  recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(), sequence: bigint('sequence', { mode: 'number' }).generatedAlwaysAsIdentity().unique(), actorId: text('actor_id').notNull().references(() => accounts.id),
}, t => [uniqueIndex('completion_occurrence_idx').on(t.employeeId, t.eventId, t.occurrenceKey), index('completions_employee_sequence_idx').on(t.employeeId, t.sequence)]);
export const actionReceipts = pgTable('action_receipts', {
  actorId: text('actor_id').notNull().references(() => accounts.id), operation: text('operation').notNull(), idempotencyKey: text('idempotency_key').notNull(), requestHash: text('request_hash').notNull(), result: jsonb('result').notNull(), recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [primaryKey({ columns: [t.actorId, t.operation, t.idempotencyKey] })]);
export const importBatches = pgTable('import_batches', { id: text('id').primaryKey(), actorId: text('actor_id').notNull().references(() => accounts.id), fingerprint: text('fingerprint').notNull(), result: jsonb('result').notNull(), recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow() });
export const auditRecords = pgTable('audit_records', { id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(), actorId: text('actor_id').notNull().references(() => accounts.id), operation: text('operation').notNull(), targetEmployeeId: text('target_employee_id').references(() => employees.employeeId), details: jsonb('details').notNull(), recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow() });
