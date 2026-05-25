## 1. Playbook Document

- [ ] 1.1 Create `docs/agent-collaboration-playbooks.md` with an overview of the inter-agent collaboration model and participants.
- [ ] 1.2 Add a concrete two-agent software-project scenario, including roles, responsibilities, and an end-to-end flow diagram.
- [ ] 1.3 Document prerequisites for two machine bots, shared-room enablement, paired Pi sessions, machine ids/aliases, capabilities, trusted peers, and autonomy levels.
- [ ] 1.4 Add safe configuration snippets for two collaborating machines without tokens, secrets, pairing codes, hidden prompts, raw tool inputs, or full transcripts.

## 2. Workflow Examples

- [ ] 2.1 Add a bounded example transcript showing human request, source-agent decomposition, `/delegate`, visible task card, claim/approval, target execution, result reporting, and source-agent follow-up.
- [ ] 2.2 Show platform-neutral command forms plus links or notes for Telegram, Discord, and Slack command-surface differences.
- [ ] 2.3 Explicitly label ordinary bot output as inert and distinguish it from validated delegation commands/actions.
- [ ] 2.4 Add guidance for safe delegation goal writing, including what not to include in task goals.

## 3. Safety and Validation

- [ ] 3.1 Document peer-bot trust boundaries, room scoping, capability matching, authorization-before-action, loop prevention, task expiry, bounded summaries, and delegation depth.
- [ ] 3.2 Document how approval gates interact with delegated project work and include an example sensitive operation that requires human approval.
- [ ] 3.3 Add a manual or optional smoke checklist covering the happy path, non-target silence, untrusted peer rejection, inert ordinary output, approval-gate behavior, and secret redaction.

## 4. Cross-links and Validation

- [ ] 4.1 Link the playbook from `README.md`, `docs/config.md`, `docs/shared-room-parity.md`, and `docs/testing.md` where relevant.
- [ ] 4.2 Run the smallest relevant docs validation, including `openspec validate add-agent-collaboration-playbooks --strict`.
