import { z } from 'zod';
import type { InvalidResult, Operation } from './model.ts';

type ParseResult = { valid: true; operation: Operation } | { valid: false; result: InvalidResult };

export const MAX_TEXT_BYTES = 64 * 1024;

const lowercaseUuid = z
  .uuid()
  .refine((id) => id === id.toLowerCase(), { message: 'must be a lowercase UUID' });

const noteText = z
  .string()
  .refine((text) => !text.includes('\u0000'), { message: 'must not contain U+0000' })
  .refine((text) => text.isWellFormed(), { message: 'must not contain a lone surrogate' })
  .refine((text) => Buffer.byteLength(text, 'utf8') <= MAX_TEXT_BYTES, {
    message: `must be at most ${String(MAX_TEXT_BYTES)} bytes`,
  });

const operationSchema = z.object({
  op_id: lowercaseUuid,
  note_id: lowercaseUuid,
  base_revision: z.int().nonnegative(),
  text: noteText,
}) satisfies z.ZodType<Operation>;

export function parseOperation(input: unknown): ParseResult {
  const parsed = operationSchema.safeParse(input);
  if (parsed.success) {
    return { valid: true, operation: parsed.data };
  }
  return {
    valid: false,
    result: {
      op_id: readOperationId(input),
      status: 'invalid',
      errors: parsed.error.issues.map((issue) => ({
        field: issue.path.length > 0 ? issue.path.join('.') : null,
        message: issue.message,
      })),
    },
  };
}

function readOperationId(input: unknown): string | null {
  if (typeof input !== 'object' || input === null || !('op_id' in input)) {
    return null;
  }
  return typeof input.op_id === 'string' ? input.op_id : null;
}
