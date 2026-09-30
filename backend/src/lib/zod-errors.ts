import type { ZodIssue } from 'zod';

/** Turns zod issues into a readable message: "field: reason; field2: reason". */
export function formatZodErrors(issues: ZodIssue[]): string {
  return issues
    .map((i) => {
      const path = i.path.join('.');
      return path ? `${path}: ${i.message}` : i.message;
    })
    .join('; ');
}
