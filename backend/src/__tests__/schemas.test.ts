import { adminCreateUserSchema } from '@app/shared';
import { formatZodErrors } from '../lib/zod-errors.js';

describe('adminCreateUserSchema', () => {
  it('defaults role to USER', () => {
    const parsed = adminCreateUserSchema.parse({
      email: 'user@test.dev',
      password: 'Secret123',
    });
    expect(parsed.role).toBe('USER');
  });

  it('rejects an invalid email', () => {
    const result = adminCreateUserSchema.safeParse({ email: 'nope', password: 'Secret123' });
    expect(result.success).toBe(false);
  });
});

describe('formatZodErrors', () => {
  it('returns a readable message including the field path', () => {
    const result = adminCreateUserSchema.safeParse({ email: 'nope', password: 'short' });
    if (result.success) throw new Error('expected validation to fail');
    const msg = formatZodErrors(result.error.issues);
    expect(msg).toContain('email');
  });
});
