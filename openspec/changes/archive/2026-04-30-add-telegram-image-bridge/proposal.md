## Why

The Telegram tunnel currently only forwards text prompts and text/Markdown outputs, so mobile users cannot send screenshots/photos for Pi to inspect or retrieve image artifacts produced during a session. Pi already supports image content in user messages and tool results, making image bridging a natural extension of the existing tunnel contract.

## What Changes

- Accept authorized Telegram photo messages and image documents, including captions, and inject them into the bound Pi session as multimodal user messages.
- Preserve existing busy-session routing semantics for image prompts: idle messages start a prompt, while busy messages follow the configured default or explicit `/steer` and `/followup` command behavior.
- Add safe Telegram file download handling with MIME/type validation, size limits, and clear rejection messages for unsupported files.
- Track image outputs produced during the latest Pi turn and let the authorized Telegram user retrieve them explicitly from Telegram.
- Treat safe image files produced or referenced during the latest Pi turn as retrievable image candidates, so a natural "save/render/send it as PNG" conversation can be completed from Telegram without requiring the agent to re-open the file manually.
- Improve Telegram image retrieval UX with clearer empty states and explicit path-based image sending for validated workspace image files.
- Keep image transfer authorization, paused/offline behavior, and broker runtime parity aligned with existing text and inline-action behavior.
- Avoid automatically echoing local user-provided images or arbitrary workspace files to Telegram.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `telegram-session-tunnel`: Add requirements for Telegram-to-Pi image prompt delivery and explicit Pi-to-Telegram latest-turn image retrieval.

## Impact

- `extensions/telegram-tunnel/types.ts`: inbound update, route action, and notification metadata types need image-aware fields.
- `extensions/telegram-tunnel/telegram-api.ts` and `extensions/telegram-tunnel/broker.js`: Telegram update parsing, file lookup/download, and outbound image/document sending.
- `extensions/telegram-tunnel/runtime.ts` and broker IPC paths: image authorization, delivery, latest image tracking, and `/images` or inline retrieval handling.
- `extensions/telegram-tunnel/index.ts`: capture image content and safe latest-turn image file references from relevant Pi events and expose them to the runtime/broker without leaking secrets or unrelated files.
- Tests for Telegram API parsing, in-process runtime behavior, broker parity, size/type rejection, and latest-turn image retrieval.
