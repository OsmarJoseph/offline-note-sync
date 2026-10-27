import { ConfigModule } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { count, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DATABASE, DatabaseModule, type Database } from '../src/db/database.module.ts';
import { notes, operations } from '../src/db/schema.ts';
import type { Operation, OperationResult } from '../src/domain/model.ts';
import { validateEnv } from '../src/env.ts';
import { SyncRepository } from '../src/sync.repository.ts';
import { SyncService } from '../src/sync.service.ts';
import { note, noteId, otherNoteId, uuid } from './fixtures.ts';

let testingModule: TestingModule;
let service: SyncService;
let database: Database;

beforeAll(async () => {
  testingModule = await Test.createTestingModule({
    imports: [ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }), DatabaseModule],
    providers: [SyncRepository, SyncService],
  }).compile();
  service = testingModule.get(SyncService);
  database = testingModule.get(DATABASE);
});

afterAll(async () => {
  await testingModule.close();
});

beforeEach(async () => {
  await resetDatabase();
});

async function resetDatabase(): Promise<void> {
  await database.execute(sql`truncate ${notes}, ${operations}`);
}

async function countRows(table: typeof notes | typeof operations): Promise<number> {
  const [row] = await database.select({ rows: count() }).from(table);
  return row?.rows ?? 0;
}

async function syncOperationsInOrder(operations: Operation[]): Promise<OperationResult[]> {
  const results: OperationResult[] = [];
  for (const sent of operations) {
    results.push(await service.syncOperation(sent));
  }
  return results;
}

function sortedStatuses(results: OperationResult[]): string[] {
  return results.map((result) => result.status).sort();
}

describe('a new op_id', () => {
  it('creates a note at revision 1 from base 0', async () => {
    expect(
      await service.syncOperation({
        op_id: uuid(1),
        note_id: noteId,
        base_revision: 0,
        text: 'new',
      }),
    ).toEqual({
      op_id: uuid(1),
      status: 'applied',
      note: note('new', 1),
    });
    expect(await service.readNote(noteId)).toEqual(note('new', 1));
  });

  it('is note_not_found with the rejected text when an edit names a missing note', async () => {
    expect(
      await service.syncOperation({
        op_id: uuid(1),
        note_id: noteId,
        base_revision: 2,
        text: 'mine',
      }),
    ).toEqual({
      op_id: uuid(1),
      status: 'note_not_found',
      note_id: noteId,
      rejected_text: 'mine',
    });
    expect(await service.readNote(noteId)).toBeUndefined();
  });

  it('applies an edit whose base matches and raises the revision by 1', async () => {
    await service.syncOperation({
      op_id: uuid(1),
      note_id: noteId,
      base_revision: 0,
      text: 'server',
    });
    expect(
      await service.syncOperation({
        op_id: uuid(2),
        note_id: noteId,
        base_revision: 1,
        text: 'edited',
      }),
    ).toEqual({
      op_id: uuid(2),
      status: 'applied',
      note: note('edited', 2),
    });
    expect(await service.readNote(noteId)).toEqual(note('edited', 2));
  });

  it.each([
    ['lower than', 1],
    ['higher than', 5],
  ])('is a conflict when the base is %s the note revision', async (_, baseRevision) => {
    await syncOperationsInOrder([
      { op_id: uuid(1), note_id: noteId, base_revision: 0, text: 'a' },
      { op_id: uuid(2), note_id: noteId, base_revision: 1, text: 'b' },
    ]);
    expect(
      await service.syncOperation({
        op_id: uuid(3),
        note_id: noteId,
        base_revision: baseRevision,
        text: 'mine',
      }),
    ).toEqual({
      op_id: uuid(3),
      status: 'conflict',
      note: note('b', 2),
      rejected_text: 'mine',
    });
    expect(await service.readNote(noteId)).toEqual(note('b', 2));
  });

  it('accepts an empty text edit that clears a note', async () => {
    await service.syncOperation({ op_id: uuid(1), note_id: noteId, base_revision: 0, text: 'a' });
    expect(
      await service.syncOperation({ op_id: uuid(2), note_id: noteId, base_revision: 1, text: '' }),
    ).toEqual({
      op_id: uuid(2),
      status: 'applied',
      note: note('', 2),
    });
  });
});

describe('the case example', () => {
  const operationIds = { create: uuid(1), editA: uuid(2), editB: uuid(3), merge: uuid(4) };
  const editBConflict = {
    op_id: operationIds.editB,
    status: 'conflict',
    note: note('edição A', 2),
    rejected_text: 'edição B',
  };

  function runExample(): Promise<OperationResult[]> {
    return syncOperationsInOrder([
      { op_id: operationIds.create, note_id: noteId, base_revision: 0, text: 'início' },
      { op_id: operationIds.editA, note_id: noteId, base_revision: 1, text: 'edição A' },
      { op_id: operationIds.editB, note_id: noteId, base_revision: 1, text: 'edição B' },
      { op_id: operationIds.editA, note_id: noteId, base_revision: 1, text: 'edição A' },
      { op_id: operationIds.merge, note_id: noteId, base_revision: 2, text: 'A + B' },
    ]);
  }

  it('follows the table', async () => {
    expect(await runExample()).toEqual([
      { op_id: operationIds.create, status: 'applied', note: note('início', 1) },
      { op_id: operationIds.editA, status: 'applied', note: note('edição A', 2) },
      editBConflict,
      { op_id: operationIds.editA, status: 'applied', note: note('edição A', 2) },
      { op_id: operationIds.merge, status: 'applied', note: note('A + B', 3) },
    ]);
    expect(await service.readNote(noteId)).toEqual(note('A + B', 3));
  });

  it('replays the edit B conflict at revision 2 while the note is at 3', async () => {
    await runExample();
    expect(
      await service.syncOperation({
        op_id: operationIds.editB,
        note_id: noteId,
        base_revision: 1,
        text: 'edição B',
      }),
    ).toEqual(editBConflict);
    expect(await service.readNote(noteId)).toEqual(note('A + B', 3));
  });

  it('answers op_id_reused when edit A comes back with another text', async () => {
    await runExample();
    expect(
      await service.syncOperation({
        op_id: operationIds.editA,
        note_id: noteId,
        base_revision: 1,
        text: 'edição C',
      }),
    ).toEqual({
      op_id: operationIds.editA,
      status: 'op_id_reused',
    });
    expect(await service.readNote(noteId)).toEqual(note('A + B', 3));
  });
});

describe('highlighted tests', () => {
  it('1: a note_not_found edit still replays as note_not_found after the note exists', async () => {
    const earlyEdit = { op_id: uuid(1), note_id: noteId, base_revision: 1, text: 'early edit' };
    const noteNotFound = {
      op_id: uuid(1),
      status: 'note_not_found',
      note_id: noteId,
      rejected_text: 'early edit',
    };

    expect(await service.syncOperation(earlyEdit)).toEqual(noteNotFound);
    expect(
      await service.syncOperation({
        op_id: uuid(2),
        note_id: noteId,
        base_revision: 0,
        text: 'created',
      }),
    ).toMatchObject({
      status: 'applied',
    });
    expect(await service.syncOperation(earlyEdit)).toEqual(noteNotFound);
    expect(await service.readNote(noteId)).toEqual(note('created', 1));
  });

  it('2: base 0 on an existing note is a conflict, and an unchanged edit raises the revision', async () => {
    await service.syncOperation({
      op_id: uuid(1),
      note_id: noteId,
      base_revision: 0,
      text: 'first',
    });

    expect(
      await service.syncOperation({
        op_id: uuid(2),
        note_id: noteId,
        base_revision: 0,
        text: 'overwrite',
      }),
    ).toEqual({
      op_id: uuid(2),
      status: 'conflict',
      note: note('first', 1),
      rejected_text: 'overwrite',
    });
    expect(
      await service.syncOperation({
        op_id: uuid(3),
        note_id: noteId,
        base_revision: 1,
        text: 'first',
      }),
    ).toEqual({
      op_id: uuid(3),
      status: 'applied',
      note: note('first', 2),
    });
    expect(await service.readNote(noteId)).toEqual(note('first', 2));
  });
});

describe('queues and resends', () => {
  it('keeps going after a conflict and a reuse', async () => {
    const results = await syncOperationsInOrder([
      { op_id: uuid(1), note_id: noteId, base_revision: 0, text: 'a' },
      { op_id: uuid(2), note_id: noteId, base_revision: 5, text: 'stale' },
      { op_id: uuid(1), note_id: noteId, base_revision: 0, text: 'b' },
      { op_id: uuid(4), note_id: noteId, base_revision: 1, text: 'c' },
    ]);
    expect(results.map((result) => result.status)).toEqual([
      'applied',
      'conflict',
      'op_id_reused',
      'applied',
    ]);
  });

  it.each([
    ['note_id', { op_id: uuid(1), note_id: otherNoteId, base_revision: 1, text: 'é' }],
    ['base_revision', { op_id: uuid(1), note_id: noteId, base_revision: 2, text: 'é' }],
    ['text by a trailing space', { op_id: uuid(1), note_id: noteId, base_revision: 1, text: 'é ' }],
    ['text by case', { op_id: uuid(1), note_id: noteId, base_revision: 1, text: 'É' }],
    [
      'text by Unicode normalization',
      { op_id: uuid(1), note_id: noteId, base_revision: 1, text: 'e\u0301' },
    ],
  ])('answers op_id_reused when %s differs', async (_, resent) => {
    await service.syncOperation({ op_id: uuid(1), note_id: noteId, base_revision: 1, text: 'é' });
    expect(await service.syncOperation(resent)).toEqual({ op_id: uuid(1), status: 'op_id_reused' });
  });

  it('changes nothing when the whole history is resent', async () => {
    const history = [
      { op_id: uuid(1), note_id: noteId, base_revision: 0, text: 'a' },
      { op_id: uuid(2), note_id: noteId, base_revision: 1, text: 'b' },
      { op_id: uuid(3), note_id: noteId, base_revision: 1, text: 'c' },
      { op_id: uuid(4), note_id: otherNoteId, base_revision: 3, text: 'd' },
      { op_id: uuid(5), note_id: noteId, base_revision: 2, text: '' },
      { op_id: uuid(6), note_id: noteId, base_revision: 0, text: 'e' },
    ];
    const firstResults = await syncOperationsInOrder(history);
    const noteAfterFirstSend = await service.readNote(noteId);

    expect(await syncOperationsInOrder(history)).toEqual(firstResults);
    expect(await service.readNote(noteId)).toEqual(noteAfterFirstSend);
    expect(await service.readNote(otherNoteId)).toBeUndefined();
    expect(await countRows(operations)).toBe(history.length);
  });
});

describe('concurrent requests', () => {
  const rounds = Array.from({ length: 20 }, (_, round) => round);

  it.each(rounds)('two creates of the same note end with one winner (round %i)', async () => {
    const results = await Promise.all([
      service.syncOperation({ op_id: uuid(1), note_id: noteId, base_revision: 0, text: 'phone' }),
      service.syncOperation({ op_id: uuid(2), note_id: noteId, base_revision: 0, text: 'laptop' }),
    ]);
    expect(sortedStatuses(results)).toEqual(['applied', 'conflict']);
    expect(await service.readNote(noteId)).toMatchObject({ revision: 1 });
  });

  it.each(rounds)('two edits from the same revision end with one winner (round %i)', async () => {
    await service.syncOperation({
      op_id: uuid(1),
      note_id: noteId,
      base_revision: 0,
      text: 'start',
    });
    const results = await Promise.all([
      service.syncOperation({ op_id: uuid(2), note_id: noteId, base_revision: 1, text: 'phone' }),
      service.syncOperation({ op_id: uuid(3), note_id: noteId, base_revision: 1, text: 'laptop' }),
    ]);
    expect(sortedStatuses(results)).toEqual(['applied', 'conflict']);
    expect(await service.readNote(noteId)).toMatchObject({ revision: 2 });
  });

  it.each(rounds)('the same operation twice is applied once (round %i)', async () => {
    const sent = { op_id: uuid(1), note_id: noteId, base_revision: 0, text: 'once' };
    const [first, second] = await Promise.all([
      service.syncOperation(sent),
      service.syncOperation(sent),
    ]);
    expect(first).toEqual({ op_id: uuid(1), status: 'applied', note: note('once', 1) });
    expect(second).toEqual(first);
    expect(await countRows(operations)).toBe(1);
  });

  it.each(rounds)('one op_id on two notes is applied to one of them (round %i)', async () => {
    const results = await Promise.all([
      service.syncOperation({ op_id: uuid(1), note_id: noteId, base_revision: 0, text: 'here' }),
      service.syncOperation({
        op_id: uuid(1),
        note_id: otherNoteId,
        base_revision: 0,
        text: 'there',
      }),
    ]);
    expect(sortedStatuses(results)).toEqual(['applied', 'op_id_reused']);
    expect(await countRows(notes)).toBe(1);
  });
});
