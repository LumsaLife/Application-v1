/**
 * Guard against the public-env inlining trap.
 *
 * Next.js inlines `process.env.NEXT_PUBLIC_*` into the browser bundle by static
 * find-and-replace on the literal text. A dynamic `process.env[name]` lookup is
 * left alone, and `process.env` is empty in the browser — so a public variable
 * read dynamically is `undefined` on the client while the server sees it fine
 * and the build stays green. That failure only surfaces when a real user loads
 * the page, which is the worst possible place to find it.
 *
 * So: every NEXT_PUBLIC_ variable that env.ts exposes must also be spelled out
 * literally in its PUBLIC_ENV map. This check enforces that pairing.
 */

import fs from "node:fs";
import path from "node:path";
import { check, section } from "./assert";

export function envChecks(): void {
  section("public env inlining");

  const source = fs.readFileSync(
    path.join(process.cwd(), "src/lib/env.ts"),
    "utf8",
  );

  // Names the module actually exposes, e.g. required("NEXT_PUBLIC_FOO").
  const used = new Set(
    [...source.matchAll(/(?:required|optional)\(\s*"(NEXT_PUBLIC_[A-Z0-9_]+)"/g)].map(
      (m) => m[1],
    ),
  );

  // Names written out literally, e.g. NEXT_PUBLIC_FOO: process.env.NEXT_PUBLIC_FOO
  const inlined = new Set(
    [
      ...source.matchAll(
        /(NEXT_PUBLIC_[A-Z0-9_]+)\s*:\s*process\.env\.(NEXT_PUBLIC_[A-Z0-9_]+)/g,
      ),
    ]
      .filter((m) => m[1] === m[2]) // key and lookup must match
      .map((m) => m[1]),
  );

  check("env.ts exposes at least one public var", used.size > 0, true);

  const missing = [...used].filter((name) => !inlined.has(name)).sort();
  check(
    "every public var is also referenced literally",
    missing,
    [],
  );

  // The two the browser genuinely cannot run without.
  for (const name of ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY"]) {
    check(`${name} is inlined`, inlined.has(name), true);
  }

  // A literal map entry is only useful if nothing shadows it with a dynamic
  // read that returns undefined on the client.
  check(
    "reads go through the map, not a bare dynamic lookup",
    /process\.env\[name\]\s*\?\?\s*PUBLIC_ENV\[name\]/.test(source),
    true,
  );
}

/**
 * Boolean env flags must survive being typed into a dashboard by hand.
 *
 * A strict `=== "true"` check fails silently on " true" or "True", giving you
 * the old behaviour with no error to explain it. Vercel settings fields render
 * leading whitespace invisibly, and this project has already lost a deploy
 * cycle to exactly that.
 */
export function flagChecks(): void {
  section("boolean env flag parsing");

  const KEY = "NEXT_PUBLIC_DEMO_MODE";
  const original = process.env[KEY];

  // Imported lazily so the module picks up each process.env mutation.
  const load = () => {
    const path = require.resolve("@/lib/env");
    delete require.cache[path];
    return require("@/lib/env").env as { demoMode: () => boolean };
  };

  const cases: [string | undefined, boolean][] = [
    ["true", true],
    ["TRUE", true],
    ["True", true],
    [" true ", true],
    ["1", true],
    ["yes", true],
    ["on", true],
    ["false", false],
    ["FALSE", false],
    ["0", false],
    ["no", false],
    ["", false],
    ["maybe", false],
    [undefined, false],
  ];

  for (const [value, expected] of cases) {
    if (value === undefined) delete process.env[KEY];
    else process.env[KEY] = value;

    check(
      `${value === undefined ? "(unset)" : JSON.stringify(value)} → ${expected}`,
      load().demoMode(),
      expected,
    );
  }

  if (original === undefined) delete process.env[KEY];
  else process.env[KEY] = original;
}
