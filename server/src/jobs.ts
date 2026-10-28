import { logger } from './lib/logger';
import { expireStaleReservations, retryPendingEffects } from './services/orders';

let timer: NodeJS.Timeout | null = null;
let running = false;

/**
 * Light background maintenance:
 *  - release stock held by unpaid online orders whose reservation lapsed (after checking the
 *    gateway for a missed payment), and
 *  - finish post-confirmation side effects that were interrupted.
 *
 * Each job is idempotent, so running several app instances at once is safe. Returns false when a
 * run was already in progress in this process.
 */
export async function runJobs(): Promise<boolean> {
  if (running) return false;
  running = true;
  try {
    const expired = await expireStaleReservations();
    if (expired) logger.info({ expired }, 'Released stock from expired unpaid orders');
    await retryPendingEffects();
  } catch (err) {
    logger.error({ err }, 'Background job failed');
  } finally {
    running = false;
  }
  return true;
}

/**
 * Runs the jobs in-process every few minutes. Hosts that pause the CPU between requests (Cloud Run
 * with request-based billing) also call POST /api/internal/jobs from a scheduler.
 */
export function startJobs(intervalMs = 5 * 60_000): void {
  timer = setInterval(() => void runJobs(), intervalMs);
  timer.unref();
  setTimeout(() => void runJobs(), 15_000).unref();
}

export function stopJobs(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
