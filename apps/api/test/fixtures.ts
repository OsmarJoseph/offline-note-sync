import type { Operation } from '../src/domain/model.ts';

export const noteId = '00000000-0000-4000-8000-00000000000a';
export const otherNoteId = '00000000-0000-4000-8000-00000000000b';

export function uuid(sequence: number): string {
  return `00000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`;
}

export function operation(
  operationId: string,
  targetNoteId: string,
  baseRevision: number,
  text: string,
): Operation {
  return { op_id: operationId, note_id: targetNoteId, base_revision: baseRevision, text };
}
