# Changelog

## 0.8.0 - 2026-06-14

- Added cross-messenger live progress updates so supported Slack, Discord, and Telegram destinations update an existing progress message where possible instead of posting repeated snapshots. #78
- Added Slack progress message references and `chat.update` support, with recoverable fallback to a new live progress message or plain text snapshot when updates fail. #78
- Added Discord progress message references and bot-message edit support, with the same best-effort fallback semantics used by other messengers. #78
- Shared the live progress delivery fallback model across runtimes: update existing progress, send a new live/editable progress message, then send a plain snapshot while keeping failures non-fatal. #78
- Hardened stale/revoked/moved binding authority coverage so live progress refs are not edited after destination authority changes. #78
- Improved relay progress UX with coalesced milestone progress, live-edit support for Telegram broker/direct paths, terminal-output separation, and safer progress-mode behavior. #77
- Fixed broker state update queue and locking behavior to keep relay state writes serialized and resilient under concurrent broker activity. #75 #76

## 0.7.2 - 2026-06-14

- Fixed npm publishing for the scoped `@zylab/pirelay` package. #74

## 0.7.1 - 2026-06-14

- Added remote skill invocation so authorized messenger users can list and invoke allowed local Pi skills from paired sessions. #70
- Added requester-scoped remote approval gates, shared-room agent delegation, and GIF image prompt support. #60 #61 #64 #66
- Fixed Telegram broker pairing and reconnect resilience, readable terminal output rendering, Telegram markdown output, and streamed assistant output fallback behavior. #59 #65 #68 #69
- Hardened approval action routing and archived completed OpenSpec changes. #62 #67
- Fixed npm package public publishing and release preparation. #72 #73

## 0.7.0 - 2026-05-15

- Added messenger command surfaces: Telegram BotCommand menus, Discord native `/relay` command metadata/routing, and Slack `/pirelay` slash-command manifest and runtime support. #56
- Improved command-surface documentation and setup guidance, including reliable Discord/Slack text fallbacks and archived OpenSpec requirements. #56 #57
- Fixed README command tables so alternatives containing `|` render correctly. #55

## 0.6.0 - 2026-05-15

- Added unified messenger file delivery and requester-scoped remote safe file requests for Telegram, Discord, and Slack. #41 #43
- Hardened revoked and disconnected bindings so stale routes, timers, and duplicate runtimes do not send protected session feedback after disconnect. #44
- Improved stale route/context safety so unavailable sessions remain offline, pairing screens are not closed by stale routes, and prompts, controls, media, and status snapshots use coherent route availability checks. #46 #47 #49
- Centralized binding authority resolution so broker, adapter, and runtime delivery paths consistently suppress stale or unauthorized bindings. #52
- Added OpenSpec designs for approval gates and messenger command surfaces to guide upcoming safe remote-control UX. #15 #51

## 0.5.0 - 2026-05-12

- Added lifecycle notifications so paired Telegram, Discord, and Slack conversations are notified when a Pi session goes offline, comes back online, or is disconnected locally. #38
- Improved relay setup and status UX with clearer readiness diagnostics, safer setup reloads, instance-scoped status keys, and paired/paused/error status line states. #36
- Improved Slack runtime UX with safer progress notification handling, readiness checks, App Home guidance, and nonfatal best-effort activity failures. #36
- Fixed Slack shared-room/channel routing so active selections are preserved safely, `pirelay to <session> <prompt>` works as a one-shot target, and stale selections are pruned after disconnects or runtime stops. #37
- Fixed Telegram setup/config behavior to prefer `PI_RELAY_TELEGRAM_BOT_TOKEN` over legacy token inputs and surface runtime registration errors accurately. #36

## 0.4.0 - 2026-05-11

- Added full Slack relay adapter/runtime support with Socket Mode ingress, pairing, trust, command handling, shared-room routing, thread context, Block Kit actions, and terminal notifications. #34
- Added real Slack live integration coverage, app manifests, and testing documentation for driver/bot workflows. #34
- Added same-host broker namespace isolation for concurrent relay runtimes and live tests. #34
- Added OpenSpec validation to GitHub CI for active change proposals. #34
- Improved shared-room parity coverage and hardened messenger shared-room behavior. #32 #33
- Fixed Telegram shared-room private bindings. #30
