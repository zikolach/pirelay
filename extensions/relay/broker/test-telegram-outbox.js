import { appendFile as appendFileDefault } from 'node:fs/promises';

export function testTelegramOutboxPathFromEnv(env = process.env) {
  const outboxPath = env.PI_RELAY_BROKER_TEST_TELEGRAM_OUTBOX_PATH;
  if (!outboxPath) return undefined;
  return env.TELEGRAM_TUNNEL_BROKER_SKIP_POLLING === '1' ? outboxPath : undefined;
}

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
