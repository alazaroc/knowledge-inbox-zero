// Vitest global setup for the frontend test suite.
// Registers jest-dom matchers (toBeInTheDocument, etc.) and cleans up the
// rendered DOM after each test so tests stay isolated.
import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => {
  cleanup();
});
