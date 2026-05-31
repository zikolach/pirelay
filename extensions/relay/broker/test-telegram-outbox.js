import { appendFile as appendFileDefault } from 'node:fs/promises';

export async function appendTestTelegramOutbox(event, options = {}) {
  const { outboxPath, appendFile = appendFileDefault, recordDiagnostic = () => undefined } = options;
  if (!outboxPath) return false;
  try {
    await appendFile(outboxPath, `${JSON.stringify(event)}\n`, { mode: 0o600 });
    return true;
  } catch (error) {
    recordDiagnostic({
      component: 'broker',
      event: 'test_telegram_outbox',
      outcome: 'error',
      severity: 'warning',
      details: { error: error instanceof Error ? error.message : String(error) },
    });
    return false;
  }
}
