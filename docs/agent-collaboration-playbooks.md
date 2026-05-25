# Agent collaboration playbooks

PiRelay can coordinate multiple Pi agents through a shared messenger room when each machine runs its own dedicated bot/app identity. The shared room is the coordination surface; each Pi session still runs locally, keeps its own tools and state, and only accepts work after normal authorization and delegation policy checks.

This page shows a concrete two-agent workflow for a common software project: one agent plans and reviews a failing CI fix while another agent reproduces and validates the failure on a different machine.

## Collaboration model

```text
                 shared Slack / Discord / Telegram room
┌────────────────────────────────────────────────────────────────┐
│ Human operator                                                  │
│ planner-laptop bot/app       worker-linux bot/app               │
│ visible task cards, claims, bounded summaries, approvals        │
└───────────────┬───────────────────────────────┬────────────────┘
                │                               │
                ▼                               ▼
      planner-laptop Pi session        worker-linux Pi session
      source / planner agent           target / worker agent
      reads issue, decomposes work      runs tests, edits, validates
```

The only machine-actionable inter-agent messages are validated delegation commands, task-card actions, and supported task controls. Ordinary bot output, summaries, and commentary are inert: other bots may display or observe them, but must not treat them as new prompts or tasks unless a validated delegation command/action is present.

## Playbook: fix a failing CI test with two agents

### Participants

| Participant | Example identity | Responsibility | Room-visible output |
| --- | --- | --- | --- |
| Human operator | authorized user | Starts the workflow, approves sensitive actions, cancels or redirects work | Prompts, approvals, `/task` controls |
| Planner agent | `planner-laptop` machine bot and local Pi session `review` | Reads issue/PR/CI context, decides what to delegate, reviews worker result | Delegation task card, review summary, follow-up requests |
| Worker agent | `worker-linux` machine bot and local Pi session `tests` | Reproduces failure, makes or suggests minimal fix, runs validation | Claim/update/result summary |

### End-to-end flow

```text
1. Human asks planner agent to investigate failing CI.
2. Planner agent identifies a bounded task for the worker machine.
3. A validated /delegate command creates a visible task card in the shared room.
4. Worker agent claims the task manually or through configured auto-claim policy.
5. PiRelay injects a bounded delegated-task prompt into worker-linux/tests.
6. Worker agent runs local investigation and reports a bounded result to the room.
7. Planner agent reviews the result and either asks a follow-up or summarizes the fix.
8. Sensitive steps, such as git push or package publish, still require approval gates.
```

## Prerequisites

- One dedicated bot/app identity per machine in the same shared room. Do not share one bot token across machines.
- Shared-room control enabled for the target messenger instance.
- A local Pi session paired on each machine, for example `planner-laptop/review` and `worker-linux/tests`.
- Stable `relay.machineId` values or aliases so commands can target machines unambiguously.
- Non-secret capability labels for machines that can claim capability-targeted work, such as `linux-tests`, `review`, or `frontend`.
- Delegation explicitly enabled per messenger instance.
- Trusted peer-bot identities configured separately from human allow-lists.
- An autonomy level that matches your safety posture:
  - `off`: never create, claim, or inject work from bot-authored delegation.
  - `propose-only`: render task cards for human review; no autonomous injection.
  - `auto-claim-targeted`: allow configured peers to auto-claim tasks explicitly targeting this machine.
  - `auto-claim-safe-capability`: allow configured peers to auto-claim capability-targeted work when local policy declares the capability safe.
- Approval gates configured for sensitive operations if remote delegated work may touch git remotes, package publishing, destructive shell commands, or protected files.

See also:

- [Configuration](config.md#multi-machine-shared-bot-setup)
- [Shared-room messenger parity](shared-room-parity.md)
- [Testing checklist](testing.md)

## Safe two-machine configuration snippets

These examples intentionally omit tokens, signing secrets, pairing codes, hidden prompts, raw tool inputs, and full transcripts. Replace user IDs, bot/app IDs, guild/channel IDs, and room hints with your messenger's non-secret identifiers.

### Planner machine

```json
{
  "relay": {
    "machineId": "planner-laptop",
    "machineAliases": ["planner"],
    "capabilities": ["review", "triage"]
  },
  "approvalGates": {
    "enabled": true,
    "timeoutMs": 120000,
    "rules": [
      { "id": "git-push", "tools": ["bash"], "categories": ["git-remote"], "commandPatterns": ["git push"] },
      { "id": "protected-files", "tools": ["write", "edit"], "pathPatterns": ["package.json", ".github/workflows/"] }
    ]
  },
  "messengers": {
    "slack": {
      "default": {
        "allowChannelMessages": true,
        "botUserId": "U_PLANNER_BOT",
        "sharedRoom": { "enabled": true, "roomHint": "C_PROJECT_ROOM" },
        "delegation": {
          "enabled": true,
          "autonomy": "propose-only",
          "taskExpiryMs": 900000,
          "runningTimeoutMs": 1800000,
          "maxDepth": 1,
          "trustedPeers": [
            {
              "peerId": "U_WORKER_BOT",
              "allowCreate": true,
              "targetMachineIds": ["planner-laptop"],
              "capabilities": ["review"]
            }
          ]
        }
      }
    }
  }
}
```

### Worker machine

```json
{
  "relay": {
    "machineId": "worker-linux",
    "machineAliases": ["worker", "linux"],
    "capabilities": ["linux-tests", "repo-validation"]
  },
  "approvalGates": {
    "enabled": true,
    "timeoutMs": 120000,
    "rules": [
      { "id": "git-push", "tools": ["bash"], "categories": ["git-remote"], "commandPatterns": ["git push"] },
      { "id": "destructive-shell", "tools": ["bash"], "categories": ["destructive"] }
    ]
  },
  "messengers": {
    "slack": {
      "default": {
        "allowChannelMessages": true,
        "botUserId": "U_WORKER_BOT",
        "sharedRoom": { "enabled": true, "roomHint": "C_PROJECT_ROOM" },
        "delegation": {
          "enabled": true,
          "autonomy": "auto-claim-targeted",
          "taskExpiryMs": 900000,
          "runningTimeoutMs": 1800000,
          "maxDepth": 1,
          "trustedPeers": [
            {
              "peerId": "U_PLANNER_BOT",
              "allowCreate": true,
              "targetMachineIds": ["worker-linux"],
              "capabilities": ["linux-tests", "repo-validation"]
            }
          ]
        }
      }
    }
  }
}
```

For Discord, use the same delegation shape under the Discord messenger instance with `allowGuildChannels`, allowed guild/channel configuration, and the worker/planner bot application IDs. For Telegram, use separate bot tokens and addressed commands such as `/delegate@planner_bot` or `/task@worker_bot` where group privacy requires addressed forms.

## Command forms

| Action | Telegram shared room | Discord shared room | Slack shared room |
| --- | --- | --- | --- |
| Create task | `/delegate <machine\|#capability> <goal>` or addressed `/delegate@bot <machine\|#capability> <goal>` | `relay delegate <machine\|#capability> <goal>` or bot mention | `relay delegate <machine\|#capability> <goal>` or app mention |
| Claim task | `/task claim <id>` or `/task@bot claim <id>` | `relay task claim <id>` | `relay task claim <id>` |
| Status/history | `/task status <id>`, `/task history <id>` | `relay task status <id>`, `relay task history <id>` | `relay task status <id>`, `relay task history <id>` |
| Cancel | `/task cancel <id>` | `relay task cancel <id>` | `relay task cancel <id>` |

Private-chat pairing and local terminal commands remain separate. A shared-room task should report to the originating room/thread through the target machine bot identity; it should not leak delegated output into unrelated private chats or active selections.

## Example transcript

This transcript is illustrative and bounded. Identifiers are placeholders. The exact task-card formatting depends on the messenger adapter.

```text
Human → planner-laptop:
  Investigate why CI is failing on PR 42. Split out Linux reproduction if useful.

planner-laptop → room:
  I found the failing job is linux-unit on test CacheStoreSuite.
  I will delegate reproduction and validation to worker-linux.

planner-laptop → room (validated delegation command/action):
  /delegate worker-linux Reproduce PR 42 linux-unit failure for CacheStoreSuite, identify the minimal fix, run the focused test, and report only safe summary plus changed file paths. Do not push commits or publish artifacts.

planner-laptop bot → room:
  Task T-7K4Q proposed
  Source: planner-laptop/review
  Target: worker-linux
  Goal: Reproduce PR 42 linux-unit failure for CacheStoreSuite...
  Status: claimable until 14:30
  Actions: claim, decline, cancel, status

worker-linux bot → room:
  Task T-7K4Q claimed for worker-linux/tests.

worker-linux local Pi session receives bounded delegated prompt:
  Task T-7K4Q from planner-laptop/review.
  Goal: Reproduce PR 42 linux-unit failure for CacheStoreSuite...
  Constraints: do not push commits or publish artifacts; report safe summary to room.

worker-linux bot → room:
  Task T-7K4Q completed.
  Summary: reproduced CacheStoreSuite failure with npm test -- CacheStoreSuite.
  Minimal fix is in src/cache/store.ts; focused test now passes.
  Validation: npm test -- CacheStoreSuite.
  Sensitive actions: no git push or publish attempted.

planner-laptop → room:
  Reviewed worker summary. I will inspect src/cache/store.ts and prepare the PR response.
```

Only the `/delegate` command/action and `/task` controls in this transcript are machine-actionable. The summaries are ordinary bot output and are inert unless a validated delegation command or task action accompanies them.

## Writing safe delegation goals

Good delegation goals are bounded, non-secret, and outcome-oriented.

Prefer:

```text
/delegate worker-linux Reproduce failing test CacheStoreSuite from PR 42, identify likely cause, run the focused test, and report safe summary plus changed file paths. Do not push commits.
```

Avoid:

```text
/delegate worker-linux Use this production token: ...; inspect the hidden customer transcript; push directly to main when done.
```

Do not include:

- Bot tokens, OAuth tokens, signing secrets, API keys, or pairing links.
- Hidden prompts, raw tool internals, full transcripts, private customer data, or credentials.
- Broad authority such as “do anything necessary” when the task can be bounded.
- Instructions to bypass approval gates or human review.

## Safety boundaries

- **Authorization first:** PiRelay authorizes the sender, room, target, and peer policy before task creation, prompt injection, media download, callback/action handling, approval resolution, or state mutation.
- **Peer trust is separate:** Human allow-lists do not make a bot trusted for delegation. Configure peer bot identities explicitly and scope them to rooms, target machines, capabilities, and allowed actions.
- **Targeting is explicit:** Shared-room prompts route only to the explicitly addressed machine or to a local active selection. Non-target bots stay silent.
- **Task lifecycle is bounded:** Task ids, expiry, running timeout, recent-history limits, bounded summaries, and maximum delegation depth reduce stale work and accidental loops.
- **Ordinary bot output is inert:** Completion summaries and commentary are not executable requests.
- **Loop prevention:** A machine ignores its own bot output and rejects untrusted, untargeted, stale, or ordinary bot-authored text that is not a validated delegation event.
- **Approval gates still apply:** Claiming a delegated task does not approve sensitive tool calls. Use approval gates for git remotes, publishing, destructive shell, protected paths, or other sensitive operations.

### Approval-gated sensitive operation example

If the worker task discovers a fix and tries to run `git push`, an approval gate rule such as `git-push` should pause the operation and ask the authorized requester to approve or deny it. The task claim itself is not a blanket grant. Prefer human approval in the shared room for project-changing operations, and keep approvals scoped to the operation, task, or session according to local policy.

## Manual smoke checklist

Run this with disposable or non-production messenger credentials when possible. Never paste production tokens, pairing codes, hidden prompts, raw tool inputs, or private transcripts into logs.

1. Configure two machines with distinct bot/app identities in one shared room.
2. Pair one local Pi session per machine and confirm `/sessions` or the platform equivalent shows only local sessions for each addressed machine.
3. Enable delegation with conservative policy, such as `propose-only` on the planner and `auto-claim-targeted` only for the worker if acceptable.
4. From the human account or a trusted source bot, create a task targeting the worker: `/delegate worker-linux run a harmless status check and report safe summary`.
5. Verify a visible task card appears and includes a bounded id, source, target, status, expiry, and safe controls.
6. Claim the task with `/task claim <id>` if auto-claim is disabled.
7. Verify only the worker local Pi session receives the delegated prompt, and non-target machines remain silent except for permitted observation state.
8. Complete the worker task and verify a bounded result appears in the originating room/thread through the worker bot identity.
9. Send an untrusted bot-authored `/delegate`-like message and verify no task is created, no prompt is injected, no media is downloaded, and no callback side effects occur.
10. Send ordinary bot output that resembles a request and verify other bots treat it as inert.
11. Trigger a configured sensitive operation, such as a harmless dry-run command matching an approval rule, and verify approval is requested instead of silently proceeding.
12. Review logs and room messages to confirm tokens, pairing codes, hidden prompts, raw tool inputs, and full transcripts were not printed.
