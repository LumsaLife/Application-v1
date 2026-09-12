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
