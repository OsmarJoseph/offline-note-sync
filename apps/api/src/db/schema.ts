import { sql } from 'drizzle-orm';
import { check, integer, pgEnum, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

export const notes = pgTable('notes', {
  id: uuid().primaryKey(),
  text: text().notNull(),
  revision: integer().notNull(),
});

export const operationStatus = pgEnum('operation_status', [
  'applied',
  'conflict',
  'note_not_found',
]);

export const operations = pgTable(
  'operations',
  {
    opId: uuid().primaryKey(),
    noteId: uuid().notNull(),
    baseRevision: integer().notNull(),
    text: text().notNull(),
    status: operationStatus().notNull(),
    revision: integer(),
  },
  (table) => [
    uniqueIndex('operations_applied_revision_unique')
      .on(table.noteId, table.revision)
      .where(sql`${table.status} = 'applied'`),
    check(
      'operations_revision_unless_note_not_found',
      sql`(${table.status} = 'note_not_found') = (${table.revision} is null)`,
    ),
  ],
);
