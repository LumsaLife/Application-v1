/**
 * Seed the Daily Light challenge library.
 *
 *   npm run seed:challenges
 *   npm run seed:challenges -- --dry-run
 *
 * Upserts on `slug`, so the seed file is the source of truth and re-running is
 * safe — no duplicates, no reordering.
 *
 * On `weight` and `active`: the seed file usually omits them. Omitted columns
 * are not written on conflict, so a value you tuned in the Supabase table
 * editor survives a re-seed. Add them explicitly to a seed entry and the file
 * wins from then on. That is the whole rule.
 */

import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const SEED_PATH = path.join(process.cwd(), "supabase/seed/challenges.seed.json");

const CATEGORIES = new Set([
  "generosity", "connection", "grace", "presence",
  "words", "service", "gratitude", "family",
]);
const COSTS = new Set(["none", "small"]);
const CONTEXTS = new Set(["anywhere", "out", "work", "home"]);
const AUDIENCES = new Set(["adult", "family", "both"]);

interface SeedRow {
  slug: string;
  title: string;
  invitation: string;
  category: string;
  effort: number;
  cost?: string;
  context: string;
  audience: string;
  requires_others?: boolean;
  weight?: number;
  active?: boolean;
}

function loadEnvLocal() {
  const file = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (!match) continue;
    const [, key, value] = match;
    if (!process.env[key]) {
      process.env[key] = value.trim().replace(/^["']|["']$/g, "");
    }
  }
}

/**
 * Validate before writing. The database has CHECK constraints for all of this,
 * but a failed batch insert reports one violation without saying which row —
 * checking here names the slug and the field.
 */
function validate(rows: SeedRow[]): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();

  rows.forEach((row, index) => {
    const where = `[${index}] ${row.slug ?? "(no slug)"}`;

    if (!row.slug) problems.push(`${where}: missing slug`);
    else if (seen.has(row.slug)) problems.push(`${where}: duplicate slug`);
    else seen.add(row.slug);

    if (!row.title?.trim()) problems.push(`${where}: missing title`);
    if (!row.invitation?.trim()) problems.push(`${where}: missing invitation`);

    if (!CATEGORIES.has(row.category)) {
      problems.push(`${where}: bad category "${row.category}"`);
    }
    if (!Number.isInteger(row.effort) || row.effort < 1 || row.effort > 3) {
      problems.push(`${where}: effort must be 1-3, got ${row.effort}`);
    }
    if (row.cost !== undefined && !COSTS.has(row.cost)) {
      problems.push(`${where}: bad cost "${row.cost}"`);
    }
    if (!CONTEXTS.has(row.context)) {
      problems.push(`${where}: bad context "${row.context}"`);
    }
    if (!AUDIENCES.has(row.audience)) {
      problems.push(`${where}: bad audience "${row.audience}"`);
    }
    if (row.weight !== undefined && (!Number.isInteger(row.weight) || row.weight < 1)) {
      problems.push(`${where}: weight must be a positive integer`);
    }
  });

  return problems;
}

/**
 * Group rows by their exact set of keys.
 *
 * PostgREST builds one INSERT per request and requires every row in it to have
 * the same columns; mixing rows that specify `weight` with rows that don't
 * would either error or write nulls over the missing ones.
 */
function groupByShape(rows: SeedRow[]): SeedRow[][] {
  const groups = new Map<string, SeedRow[]>();
  for (const row of rows) {
    const shape = Object.keys(row).sort().join(",");
    const group = groups.get(shape);
    if (group) group.push(row);
    else groups.set(shape, [row]);
  }
  return [...groups.values()];
}

async function main() {
  loadEnvLocal();

  const dryRun = process.argv.includes("--dry-run");

  if (!fs.existsSync(SEED_PATH)) {
    console.error(`Seed file not found: ${SEED_PATH}`);
    process.exit(1);
  }

  const rows = JSON.parse(fs.readFileSync(SEED_PATH, "utf8")) as SeedRow[];
  if (!Array.isArray(rows)) {
    console.error("Seed file must contain a JSON array.");
    process.exit(1);
  }

  const problems = validate(rows);
  if (problems.length > 0) {
    console.error(`\n${problems.length} problem(s) in the seed file:\n`);
    for (const problem of problems) console.error(`  ${problem}`);
    console.error("");
    process.exit(1);
  }

  const byCategory = rows.reduce<Record<string, number>>((acc, row) => {
    acc[row.category] = (acc[row.category] ?? 0) + 1;
    return acc;
  }, {});

  console.log(`\n${rows.length} challenges, all valid.`);
  console.log(
    Object.entries(byCategory)
      .sort()
      .map(([category, count]) => `  ${category.padEnd(12)} ${count}`)
      .join("\n"),
  );

  if (dryRun) {
    console.log("\n--dry-run: nothing written.\n");
    return;
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    console.error(
      "\nNEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set " +
        "(they can live in .env.local). Use --dry-run to validate without them.\n",
    );
    process.exit(1);
  }

  // Service role: the RLS policy on `challenges` allows writes only to admins,
  // and a seed script has no signed-in user to be one.
  const supabase = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  let written = 0;
  for (const group of groupByShape(rows)) {
    const { error, count } = await supabase
      .from("challenges")
      .upsert(group, { onConflict: "slug", count: "exact" });

    if (error) {
      console.error(`\nUpsert failed: ${error.message}\n`);
      process.exit(1);
    }
    written += count ?? group.length;
  }

  const { count: total } = await supabase
    .from("challenges")
    .select("id", { count: "exact", head: true });

  console.log(`\nUpserted ${written}. Library now holds ${total ?? "?"}.\n`);
}

void main().catch((error) => {
  console.error("\nSeed failed:", error);
  process.exit(1);
});
