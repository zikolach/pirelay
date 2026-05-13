## 1. Reproduce and Pin Down Routing Semantics

- [x] 1.1 Add Slack runtime regression coverage proving channel pairing persists `activeChannelSelections` and the next plain prompt calls `sendUserMessage`.
- [x] 1.2 Add coverage proving `pirelay use <session>` in a Slack channel persists active selection and enables later plain prompts.
- [x] 1.3 Add coverage proving `pirelay to <machine> <session> <prompt>` injects a one-shot prompt without changing active selection.
- [x] 1.4 Add coverage proving session-only `pirelay to <session> <prompt>` works when unambiguous in a single-machine Slack channel context.
- [x] 1.5 Add negative coverage proving unrelated plain channel chatter and remote-machine targets do not inject prompts.

## 2. Slack Routing Fix

- [x] 2.1 Refactor Slack shared-room pre-routing so recognized `use` and `to` commands are not accidentally swallowed before normal command handling.
- [x] 2.2 Ensure successful Slack channel `use` commands write active selection state for the Slack conversation/user and matching instance.
- [x] 2.3 Ensure successful Slack channel pairing writes active selection state and that later state updates preserve `activeChannelSelections`.
- [x] 2.4 Fix Slack channel `to` parsing so local machine-qualified and unambiguous session-only forms hand the prompt to the target route.
- [x] 2.5 Return Slack-safe usage/disambiguation guidance for malformed local `use`/`to` commands instead of claiming success or silently dropping.

## 3. Validation and Documentation

- [x] 3.1 Update Slack help/docs only if implementation changes the documented channel command forms.
- [x] 3.2 Run `npm run typecheck`.
- [x] 3.3 Run targeted Slack runtime tests.
- [x] 3.4 Run `npm test`.
- [x] 3.5 Run `openspec validate fix-slack-channel-routing --strict`.
