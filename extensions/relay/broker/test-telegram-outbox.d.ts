export type TestTelegramOutboxAppendFile = (path: string, data: string, options: { mode: number }) => Promise<void>;

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

export function appendTestTelegramOutbox(event: unknown, options?: TestTelegramOutboxOptions): Promise<boolean>;
