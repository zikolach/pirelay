# Legacy Telegram tunnel fixtures

Representative legacy inputs for the `harden-multi-messenger-support` migration work.

- `config.json` covers the old top-level Telegram token/state settings, namespaced Discord settings, and legacy env-style JSON keys.
- `state.json` covers setup cache, active/revoked Telegram bindings, channel bindings, and pending pairings that must not copy active pairing secrets during migration.

All tokens and identifiers are fake test values.
