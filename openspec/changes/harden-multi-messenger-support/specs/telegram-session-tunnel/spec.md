## REMOVED Requirements

### Requirement: Session-scoped Telegram pairing
**Reason**: Replaced by messenger-neutral session pairing in `messenger-relay-sessions`.
**Migration**: Use `/relay connect telegram:<instance> [label]`; legacy bindings migrate to `telegram:default`.

### Requirement: Pairing authorization and revocation
**Reason**: Replaced by messenger-neutral authorization and revocation requirements.
**Migration**: Use `/relay disconnect` and messenger-neutral binding records.

### Requirement: Remote prompt delivery
**Reason**: Replaced by shared prompt routing across all messengers.
**Migration**: Send prompts through the selected paired messenger or use `/to <session> <prompt>`.

### Requirement: Remote control commands
**Reason**: Replaced by shared remote controls across all messengers.
**Migration**: Use `/status`, `/abort`, `/compact`, and `/disconnect` through the paired messenger or local `/relay` commands.

### Requirement: Completion notifications and summaries
**Reason**: Replaced by shared completion, progress, and output retrieval requirements.
**Migration**: Notification preferences migrate into messenger-neutral binding state.

### Requirement: Full output retrieval
**Reason**: Replaced by shared full-output retrieval across all messengers.
**Migration**: Use `/full` or platform-native full-output actions through any supported messenger.

### Requirement: Actionable long-output delivery
**Reason**: Replaced by shared output retrieval and adapter capability fallbacks.
**Migration**: Use messenger-neutral completion notifications and full-output actions.

### Requirement: Interactive answer workflow
**Reason**: Replaced by shared guided actions and stale-state handling.
**Migration**: Guided answer state migrates to messenger-neutral action state when it is safe and current.

### Requirement: Reliable structured answer detection
**Reason**: Replaced by shared guided answer parsing used by all messengers.
**Migration**: Keep the parser in shared relay code and render detected options per adapter.

### Requirement: Inline Telegram answer actions
**Reason**: Replaced by messenger-neutral action rendering with button and text fallbacks.
**Migration**: Telegram inline actions become one adapter renderer for shared action state.

### Requirement: Custom Telegram answer capture
**Reason**: Replaced by shared custom-answer capture across messenger identities.
**Migration**: Scope pending custom-answer state by messenger ref, platform identity, route, and turn id.

### Requirement: One-click latest assistant output retrieval
**Reason**: Replaced by shared latest-output actions across messenger adapters.
**Migration**: Render `Show in chat` and `Download` equivalents according to adapter capabilities.

### Requirement: Mobile-friendly Telegram chat formatting
**Reason**: Replaced by adapter-specific formatting under shared output semantics.
**Migration**: Keep Telegram chat formatting as a Telegram adapter renderer, not a session-tunnel requirement.

### Requirement: Callback authorization and broker parity
**Reason**: Replaced by messenger-neutral authorization, action, middleware, and broker-federation parity requirements.
**Migration**: Scope every action by messenger ref, platform identity, route, and turn id.

### Requirement: Session lifecycle handling
**Reason**: Replaced by broker topology and messenger-neutral route lifecycle requirements.
**Migration**: Register and unregister session routes with the machine-local PiRelay broker.

### Requirement: Secret-safe persistence
**Reason**: Replaced by relay-configuration and messenger-neutral state requirements.
**Migration**: Import only non-secret legacy Telegram metadata into new PiRelay state.

### Requirement: Telegram transport constraints
**Reason**: Replaced by per-adapter capability declarations and Telegram adapter-specific transport limits.
**Migration**: Keep Telegram Bot API limits in the Telegram adapter capability profile.

### Requirement: Remote image prompt delivery
**Reason**: Replaced by shared media relay semantics across messengers.
**Migration**: Validate and inject images through common media helpers after adapter authorization.

### Requirement: Telegram image transport validation
**Reason**: Replaced by per-adapter media validation and shared media relay semantics.
**Migration**: Keep Telegram file-download details in the Telegram adapter.

### Requirement: Latest turn image retrieval
**Reason**: Replaced by shared latest-image retrieval across messengers.
**Migration**: Use `/images` or platform-native image actions through any supported messenger.

### Requirement: Image bridge broker parity
**Reason**: Replaced by messenger-neutral middleware parity and broker federation requirements.
**Migration**: Broker image requests use normalized image metadata and adapter file transport.

### Requirement: Conservative guided-answer intent resolution
**Reason**: Replaced by shared guided answer intent resolution for all messengers.
**Migration**: Move Telegram-specific command examples into adapter docs while keeping parser behavior shared.

### Requirement: Answer ambiguity confirmation
**Reason**: Replaced by shared ambiguity confirmation state across messengers.
**Migration**: Render confirmation choices using platform buttons or text fallbacks.

### Requirement: Guided-answer state cleanup
**Reason**: Replaced by shared action-state lifecycle cleanup.
**Migration**: Clear stale state by messenger ref, route, platform identity, and assistant turn.

### Requirement: Answer audit accuracy
**Reason**: Replaced by messenger-neutral audit entries.
**Migration**: Audit entries identify the messenger kind and whether the event was a prompt or guided answer.

### Requirement: Human-friendly session labels
**Reason**: Replaced by messenger-neutral pairing labels.
**Migration**: Preserve legacy labels during state migration.

### Requirement: Compact multi-session listing
**Reason**: Replaced by shared session listing across messengers.
**Migration**: `/sessions` lists routes for the current messenger identity and can include machine labels.

### Requirement: Explicit active session selection
**Reason**: Replaced by shared active session selection rules.
**Migration**: `/use` updates the messenger-neutral active selection pointer for the authorized identity.

### Requirement: One-shot session targeting
**Reason**: Replaced by shared one-shot targeting.
**Migration**: `/to <session> <prompt>` works through any supported messenger adapter.

### Requirement: Multi-session notification source labels
**Reason**: Replaced by shared notification source labels.
**Migration**: Notifications include route labels, markers, and machine labels when needed for disambiguation.

### Requirement: Broker scope clarity
**Reason**: The old Telegram-only local broker model explicitly disallowed multi-machine shared bots; this change replaces it with broker ownership and federation.
**Migration**: Configure one broker per machine plus bot ingress ownership/federation for shared bot/account use.

### Requirement: Rate-limited progress updates
**Reason**: Replaced by shared progress delivery across messengers.
**Migration**: Progress preferences migrate into messenger-neutral binding state.

### Requirement: Telegram session dashboard
**Reason**: Replaced by shared session dashboard semantics rendered per messenger adapter.
**Migration**: Telegram inline dashboard buttons become one adapter-specific renderer for shared dashboard actions.

### Requirement: Notification preferences
**Reason**: Replaced by messenger-neutral notification preferences.
**Migration**: Per-binding preferences migrate with each imported binding.

### Requirement: Recent activity retrieval
**Reason**: Replaced by shared recent activity retrieval across messengers.
**Migration**: Use `/activity` or platform-equivalent dashboard actions through any paired messenger.
