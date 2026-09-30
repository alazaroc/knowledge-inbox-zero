import { itemCreateSchema } from '@app/shared';
import { formatZodErrors } from '../lib/zod-errors.js';

describe('itemCreateSchema', () => {
  it('defaults status to ACTIVE', () => {
    const parsed = itemCreateSchema.parse({ name: 'Demo' });
    expect(parsed.status).toBe('ACTIVE');
  });

  it('rejects an empty name', () => {
    const result = itemCreateSchema.safeParse({ name: '' });
    expect(result.success).toBe(false);
  });
});

describe('formatZodErrors', () => {
  it('returns a readable message including the field path', () => {
    const result = itemCreateSchema.safeParse({ name: '' });
    if (result.success) throw new Error('expected validation to fail');
    const msg = formatZodErrors(result.error.issues);
    expect(msg).toContain('name');
  });
});
