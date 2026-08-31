/**
 * Minimal assertion helper shared by the check suites.
 *
 * No test framework on purpose — see scripts/verify-logic.ts. If this grows
 * past a few hundred assertions, swap it for vitest.
 */

let failures = 0;

export function check(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;
  console.log(
    `${ok ? "  ok  " : " FAIL "} ${label}` +
      (ok
        ? ""
        : `\n         got  ${JSON.stringify(actual)}` +
          `\n         want ${JSON.stringify(expected)}`),
  );
}

export function section(name: string): void {
  console.log(`\n--- ${name} ---`);
}

export function failureCount(): number {
  return failures;
}
