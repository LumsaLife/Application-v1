/**
 * Time-budgeted batch processing for the cron routes.
 *
 * A fixed "process N items per run" cap is the wrong shape for this work: a
 * 5-minute script costs a fraction of what a 15-minute one does, and ElevenLabs
 * latency varies with load. Sizing a count cap means either leaving the function
 * mostly idle or overrunning the timeout.
 *
 * So we budget by wall clock instead. Workers keep pulling items until the
 * deadline passes, then stop cleanly and report what was deferred. Whatever
 * didn't fit is still in the queue for the next run.
 */

export interface BatchResult {
  attempted: number;
  succeeded: number;
  failed: number;
  /** Items left untouched because the deadline arrived. */
  deferred: number;
  elapsedMs: number;
}

export interface BatchOptions<T> {
  items: T[];
  handler: (item: T) => Promise<void>;
  /**
   * How many items to work on at once. Kept low: these handlers call paid APIs
   * with their own rate limits, and the goal is to fill the function's time
   * budget, not to saturate a provider.
   */
  concurrency: number;
  /**
   * Stop starting new items after this many ms have elapsed. Should leave
   * headroom under the function's maxDuration for the slowest single item to
   * finish — an item already in flight is never cancelled.
   */
  budgetMs: number;
  /** Prefix for failure logs, e.g. "cron/generate". */
  label: string;
}

export async function runBatch<T>({
  items,
  handler,
  concurrency,
  budgetMs,
  label,
}: BatchOptions<T>): Promise<BatchResult> {
  const startedAt = Date.now();
  const deadline = startedAt + budgetMs;

  let cursor = 0;
  let succeeded = 0;
  let failed = 0;

  async function worker(): Promise<void> {
    for (;;) {
      // Check the clock before claiming, so we never start work we can't finish.
      if (Date.now() >= deadline) return;

      const index = cursor++;
      if (index >= items.length) return;

      try {
        await handler(items[index]);
        succeeded += 1;
      } catch (error) {
        failed += 1;
        // One bad item must never stop the batch — a single user with a revoked
        // calendar or a script the classifier dislikes shouldn't cost everyone
        // else their morning practice.
        console.error(`[${label}] item ${index} failed:`, error);
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, worker),
  );

  const attempted = succeeded + failed;
  const deferred = items.length - attempted;

  if (deferred > 0) {
    console.warn(
      `[${label}] deadline reached with ${deferred} item(s) unprocessed; ` +
        `they remain queued for the next run.`,
    );
  }

  return {
    attempted,
    succeeded,
    failed,
    deferred,
    elapsedMs: Date.now() - startedAt,
  };
}
