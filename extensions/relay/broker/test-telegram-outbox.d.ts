export type TestTelegramOutboxAppendFile = (path: string, data: string, options: { mode: number }) => Promise<void>;

export interface TestTelegramOutboxEnv {
  PI_RELAY_BROKER_TEST_TELEGRAM_OUTBOX_PATH?: string;
  TELEGRAM_TUNNEL_BROKER_SKIP_POLLING?: string;
}

export interface TestTelegramOutboxOptions {
  outboxPath?: string;
  appendFile?: TestTelegramOutboxAppendFile;
  recordDiagnostic?: (event: {
    component: "broker";
    event: "test_telegram_outbox";
    outcome: "error";
    severity: "warning";
    details: { error: string };
  }) => void;
}

export function testTelegramOutboxPathFromEnv(env?: TestTelegramOutboxEnv): string | undefined;

export function appendTestTelegramOutbox(event: unknown, options?: TestTelegramOutboxOptions): Promise<boolean>;
