## Why

Telegram users currently receive a static "Prompt delivered to Pi" acknowledgement after sending work to Pi, which does not make it obvious that the bound Pi session is actively processing. A Telegram-native typing indicator provides better mobile feedback without adding extra chat noise.

## What Changes

- Replace or reduce the immediate "Prompt delivered to Pi" acknowledgement for accepted Telegram prompts with a Telegram chat action such as `typing` while Pi is working.
- Refresh the typing indicator periodically for the authorized chat until the active Pi turn completes, fails, is aborted, or the route becomes unavailable.
- Apply the indicator to prompts delivered directly, guided answer submissions, and busy-session follow-up/steer deliveries where Pi has accepted work.
- Fall back to the existing textual acknowledgement when Telegram chat actions cannot be sent or when the delivery does not start/continue work.
- No breaking changes to existing Telegram commands or pairing behavior.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `telegram-session-tunnel`: Add Telegram-native activity indication while a bound Pi session is processing accepted remote input.

## Impact

- `extensions/telegram-tunnel/runtime.ts` and broker runtime code will need Bot API chat-action support and lifecycle tracking for activity indicators.
- `extensions/telegram-tunnel/telegram-api.ts` and broker Telegram API usage may need a `sendChatAction` helper.
- Tests should cover indicator start/refresh/stop behavior and fallback acknowledgement behavior.
- Documentation should describe that accepted prompts show Telegram `typing...` while Pi is working instead of relying on a persistent delivery acknowledgement.
