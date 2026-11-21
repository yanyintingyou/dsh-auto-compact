# dsh-auto-compact

[English](README.md) | [中文](README.zh.md)

A DeepSeek Harness (dsh) Host plugin. It compacts a session when a turn ends, once the estimated context passes a token threshold. Same result as `/compact`, at the moment nothing else holds the maintenance slot.

## What it does

When an agent returns from `running` to `idle`, the turn is over:

1. Estimate the context with `ctx.tokenMeter.measure(session).totalTokens`.
2. Below the threshold, stop.
3. At or above it, call `compaction.compactNow(agent, signal)` for that session.

The history collapses into one summary node, exactly as `/compact` produces.

## Install

The repository root is the package root. `cordis.patch.yml` inserts one row with the `auto-compact` id.

1. Keep this directory somewhere stable.
2. In dsh, run `plugin_manager` with action `install_bundle` and the absolute directory path, or open **Plugins → Add plugin** and pick the directory.
3. Enable the bundle if it stays off after installation.

The package ships no Client half, so nothing changes in the browser.

## Configure

The default threshold is 500,000 tokens. Change it in the plugin row:

```yaml
- id: auto-compact
  name: '@local/dsh-auto-compact'
  config:
    thresholdTokens: 500000
```

## How it works

Compaction lives in each agent preset's isolated `compaction` group. The Host half reads the session's own service with `ctx.agentPresets.serviceFor(agent, 'compaction')`. A preset that mounts no compaction service, such as `minimal`, is skipped without an error.

The trigger is `agent/status` turning `idle`. At that point `compactNow` takes the maintenance slot synchronously, so a message the user sends right after queues behind the compaction instead of racing it.

Compaction sends one extra model request for the summary. Its tokens count as normal usage.

Turning the plugin off restores the built-in policy: `compaction-basic` compacts before a step once the context reaches a fraction of the window (80% by default).

## Limits

- Only stable regions compact. One oversized message can keep the context above the threshold.
- The plugin runs on the Host, so it needs a preset that mounts compaction, and it does nothing in a session whose preset has none.
- Tested on dsh `0.2.2-rc.5` (Desktop, Windows). The package declares no `engines.dsh`; check it against the dsh you run before an upgrade.

## License

MIT. See [LICENSE](LICENSE).
