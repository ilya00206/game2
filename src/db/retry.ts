const MAX_WRITE_ATTEMPTS = 5;
const BASE_BACKOFF_MS = 10;

function isBusyError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('SQLITE_BUSY') || message.includes('database is locked');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Ограниченный retry для конфликтов записи SQLite; бесконечные повторы запрещены (§2.2). */
export async function withWriteRetry<T>(
  operation: () => Promise<T>,
  attempts = MAX_WRITE_ATTEMPTS,
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (!isBusyError(error)) {
        throw error;
      }
      lastError = error;
      const backoff = BASE_BACKOFF_MS * 2 ** attempt;
      await sleep(backoff + Math.random() * backoff);
    }
  }

  throw lastError;
}
