import { act } from '@testing-library/react';
import { configureAxe } from 'jest-axe';

/**
 * Shared axe instance for page-level accessibility tests (#1397).
 * Replaces the runtime @axe-core/react hook, which does not support React 18+.
 *
 * `color-contrast` is disabled because jsdom cannot compute rendered colours;
 * contrast is covered by the Playwright + @axe-core/playwright e2e suite.
 */
export const axe = configureAxe({
  rules: {
    'color-contrast': { enabled: false },
  },
});

/** Let pending effects / mocked API promises settle before scanning. */
export async function flushAsync() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

export async function expectNoA11yViolations(container) {
  await flushAsync();
  expect(await axe(container)).toHaveNoViolations();
}
