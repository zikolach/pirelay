## Why

PiRelay currently accepts JPEG, PNG, and WebP image prompts, but GIFs are common in messenger conversations and screenshots/animations are often shared as GIF documents. Accepting GIFs by converting only the first frame lets remote users ask Pi to inspect the static visual content without broadening model-provider image input assumptions or sending unsupported animated media downstream.

## What Changes

- Accept authorized inbound GIF image documents/attachments as image prompts when the selected Pi model supports image input.
- Convert GIF input to a bounded first-frame raster image, preferably PNG, before constructing Pi image content.
- Preserve existing direct handling for JPEG, PNG, and WebP images.
- Reject corrupt, oversized, unsupported, or conversion-failed GIFs with safe actionable errors before prompt injection.
- Keep outbound `/images`, `/send-image`, and generic file delivery semantics unchanged unless a validated converted image is being sent as part of inbound prompt content.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `messenger-relay-sessions`: shared media relay semantics now include GIF first-frame conversion for authorized inbound image prompts.
- `relay-channel-adapters`: adapter capability/normalization expectations now distinguish directly supported image MIME types from convertible inbound image formats.
- `relay-configuration`: configuration documents safe defaults and limits for GIF first-frame conversion without weakening existing image MIME allow-lists.

## Impact

- Affected code: shared image/media helpers, Telegram inbound image download path, broker Telegram path, Discord/Slack normalized attachment handling if parity is included, configuration loading/docs, README/testing docs, and media/runtime tests.
- Dependencies: likely requires a GIF decoding/conversion dependency or a small internal decoder. Any dependency must be justified, bounded, and safe for runtime package installation.
- Security posture: authorization must still happen before media download; conversion must enforce original and converted size limits, avoid persisting image bytes in relay state, and avoid expanding remote users' access to arbitrary workspace files.
- No breaking changes to existing JPEG, PNG, WebP handling or outbound image/file delivery.