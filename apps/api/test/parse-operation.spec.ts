import { describe, expect, it } from 'vitest';
import type { InvalidResult } from '../src/domain/model.ts';
import { MAX_TEXT_BYTES, parseOperation } from '../src/domain/parse-operation.ts';
import { noteId, operation, otherNoteId, uuid } from './fixtures.ts';

function invalidResult(input: unknown): InvalidResult {
  const result = parseOperation(input);
  if (result.valid) {
    throw new Error('expected the operation to be invalid');
  }
  return result.result;
}

function failingFields(input: unknown): (string | null)[] {
  return invalidResult(input).errors.map((error) => error.field);
}

function isValid(input: unknown): boolean {
  return parseOperation(input).valid;
}

describe('parseOperation', () => {
  it('accepts a valid operation and drops unknown fields', () => {
    const sent = { ...operation(uuid(1), noteId, 0, 'hi'), device: 'phone', clock: 123 };
    expect(parseOperation(sent)).toEqual({
      valid: true,
      operation: operation(uuid(1), noteId, 0, 'hi'),
    });
  });

  it('accepts empty text', () => {
    expect(isValid(operation(uuid(1), noteId, 3, ''))).toBe(true);
  });

  it('accepts text of exactly 64 KiB, counted in UTF-8 bytes', () => {
    expect(isValid(operation(uuid(1), noteId, 0, 'a'.repeat(MAX_TEXT_BYTES)))).toBe(true);
    expect(isValid(operation(uuid(1), noteId, 0, 'é'.repeat(MAX_TEXT_BYTES / 2)))).toBe(true);
  });

  it('accepts a full surrogate pair', () => {
    expect(isValid(operation(uuid(1), noteId, 0, 'note 😀'))).toBe(true);
  });

  it.each([
    ['U+0000', 'a\u0000b', 'must not contain U+0000'],
    ['a lone high surrogate', 'a\uD83D', 'must not contain a lone surrogate'],
    ['a lone low surrogate', '\uDE00b', 'must not contain a lone surrogate'],
    ['more than 64 KiB', 'a'.repeat(MAX_TEXT_BYTES + 1), 'must be at most 65536 bytes'],
    [
      'more than 64 KiB of 2-byte characters',
      'é'.repeat(MAX_TEXT_BYTES / 2 + 1),
      'must be at most 65536 bytes',
    ],
  ])('rejects text with %s', (_, text, message) => {
    expect(invalidResult(operation(uuid(1), noteId, 0, text))).toEqual({
      op_id: uuid(1),
      status: 'invalid',
      errors: [{ field: 'text', message }],
    });
  });

  it('lists every failing field', () => {
    const sent = { op_id: uuid(1), note_id: 'not-a-uuid', base_revision: -1, text: 5 };
    expect(invalidResult(sent).op_id).toBe(uuid(1));
    expect(failingFields(sent)).toEqual(['note_id', 'base_revision', 'text']);
  });

  const valid = operation(uuid(1), noteId, 0, '');

  it.each([
    ['a missing op_id', { note_id: noteId, base_revision: 0, text: '' }, 'op_id'],
    ['a malformed op_id', { ...valid, op_id: 'abc' }, 'op_id'],
    ['an uppercase op_id', { ...valid, op_id: otherNoteId.toUpperCase() }, 'op_id'],
    ['an uppercase note_id', { ...valid, note_id: noteId.toUpperCase() }, 'note_id'],
    ['a fractional base_revision', { ...valid, base_revision: 1.5 }, 'base_revision'],
    ['a string base_revision', { ...valid, base_revision: '1' }, 'base_revision'],
    ['a negative base_revision', { ...valid, base_revision: -1 }, 'base_revision'],
    ['an unsafe integer base_revision', { ...valid, base_revision: 2 ** 53 }, 'base_revision'],
    ['a missing text', { op_id: uuid(1), note_id: noteId, base_revision: 0 }, 'text'],
    ['a null text', { ...valid, text: null }, 'text'],
  ])('rejects %s', (_, sent, field) => {
    expect(failingFields(sent)).toEqual([field]);
  });

  it.each([null, 'operation', 42, []])('rejects %j as a whole, with no op_id', (sent) => {
    expect(invalidResult(sent).op_id).toBeNull();
    expect(failingFields(sent)).toEqual([null]);
  });

  it('echoes a malformed string op_id but not a non-string one', () => {
    expect(invalidResult({ op_id: 'abc' }).op_id).toBe('abc');
    expect(invalidResult({ op_id: 7 }).op_id).toBeNull();
  });
});
