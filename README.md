# dsh-live-preset

Switch a DeepSeek Harness conversation to another Agent preset **after** it has
already started — from a composer chip, the `/preset` command, or an
`agent_preset` tool the agent can call itself.

## Why this exists

DSH's own preset picker only accepts a choice while the session is still blank:

```
agentPreset/locked: This session has already started
```

`agentPresets.select` refuses once `lastTurn > 0`. The mechanism was already
there — a preset revision is a scope a live Agent can be rebound to — so this
plugin performs the same operation after the first turn, with the same
bookkeeping the blank-session picker does.

## What it does

1. `agentPresets.recompose(agent.ctx, id)` rebinds the live Agent's scope to the
   target preset revision. Its tool set, prompt sections and skills come from
   that preset starting with the next step.
2. `session.append('agent-preset/selected', { agentPreset })` records the change
   with the event the shipped picker already uses, so the session projection, a
   later resume and a fork all agree with the composition the model actually ran
   under.

Refused with a reason when: a turn is still running (chip and command), the
session is not loaded, the target preset does not exist, the target preset has an
activation error, or the request did not come from this machine. Switches are
queued per session, so two clicks cannot interleave two rebinds.

## Entry points

| Where | What |
|---|---|
| Composer chip (left of the input tool row) | Shows the preset in effect; opens the roster; one click switches. |
| `/preset` | `/preset` lists the roster and the current preset, `/preset <id>` switches. |
| `agent_preset` tool | `action=list` / `action=switch`. Unlike the other two it may act inside its own turn, and it tells the model that its tool list and system prompt change from the next step. |

## Guarded presets

A preset listed in `guardPresets` (default `qq-chat`, `qq-chat-v2`) **never
exposes** the `agent_preset` tool. Those presets are reached by other people
through a chat bridge, and a self-switch there would be a path from one injected
sentence straight into the unguarded tool set. The user can still switch such a
session with the chip or `/preset`.

Change the list on the plugin row:

```yaml
- id: dsh-live-preset
  name: dsh-live-preset
  config:
    guardPresets: ['qq-chat', 'qq-chat-v2', 'another-guarded-preset']
```

The chip and the local control route accept only loopback requests (and a
loopback `Origin` when one is sent), so a page elsewhere cannot change a
session's capabilities through the browser.

## Install

```sh
dsh plugin --profile web add github:Mieksido12/dsh-live-preset
```

Then reload plugins (or restart DSH) so the Host half loads. Needs a DSH build
that composes the `agentPresets` registry — the shipped Web presets do.

Uninstall:

```sh
dsh plugin --profile web remove dsh-live-preset
```

## Limits

- It switches between declared presets; it does not edit what a preset contains.
  Adding or removing plugin rows is still a bundle change (Creator mode), and an
  already-running Agent keeps the revision it started with.
- A switch invalidates the prompt-prefix cache from that point — the model sees a
  different system prompt and tool schema, so a fresh request prefix is expected.
- Sessions that are not loaded have no live composition to rebind; open the
  conversation first.
- The agent tool cannot be used to escape a guarded preset, by design.

## Author

奥菲斯 (Orpheus) — an AI agent running in DeepSeek Harness. This plugin was
written in a conversation with the person who runs that Harness, then installed
and exercised in it before publication.

## License

MIT
