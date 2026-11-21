# dsh-auto-compact

[English](README.md) | [中文](README.zh.md)

A DeepSeek Harness Host plugin. At the end of every reply it measures the context, then compacts at the hard threshold or waits for a good moment past the soft one. Compaction calls the session preset's own service, so the result matches `/compact`.

## What it does

The agent returns to idle. The plugin checks the context:

1. Less than `minGrowthTokens` (60,000 by default) since the last compaction: do nothing.
2. At or above `hardThresholdTokens` (500,000): compact now.
3. At or above the soft threshold (hard × `softRatio`, 0.8 by default, which is 400,000): wait for a boundary.
   - `quiet`: no new input for `quietWindowMs` (30 minutes by default).
   - `milestone`: a goal just reached `complete`, or a todo list just finished.
   - `both` (default): whichever comes first.
4. Below the soft threshold: do nothing.

Two compactions sit at least `minGrowthTokens` apart. The gate stops three cases from sending a summary request at every turn end: a compaction that did not shrink the context, a compaction that failed, and the cleared state after a restart.

## Install

The repository root is the package root. `cordis.patch.yml` inserts one row, `auto-compact`.

1. Keep this directory somewhere stable.
2. Run `plugin_manager` with `install_bundle` and the absolute path, or open **Plugins → Add plugin** and pick the directory.
3. Enable the bundle if it stays off.

The package ships no Client half, so nothing changes in the browser.

## Configure

```yaml
- id: auto-compact
  name: '@local/dsh-auto-compact'
  config:
    hardThresholdTokens: 500000   # hard threshold
    softRatio: 0.8                # soft threshold = hard × 0.8
    quietWindowMs: 1800000        # quiet window, 30 minutes
    minGrowthTokens: 60000        # minimum growth between compactions
    boundary: both                # quiet | milestone | both
    dryRun: false                 # true records decisions without compacting
```

The soft threshold follows the hard one. Change the hard value and the soft value moves with it.

`/autocompact` prints the thresholds, the current context size, the growth since the last compaction, and this session's latest decision: `compacted`, `would-compact`, `nothing-to-compact`, `skip`, or `failed`, with its reason.

## How it works

Compaction lives in each agent preset's isolated `compaction` group. The Host half reads the session's copy with `ctx.agentPresets.serviceFor(agent, 'compaction')`. A preset that mounts no such service, `minimal` for example, is skipped.

The trigger is `agent/status` turning `idle`. At that point `compactNow` takes the maintenance slot synchronously, so the message the user sends right after queues behind the compaction.

Judgement reads public interfaces only: `ctx.goals.get(agent)` for the goal phase, `sessionProjections.stateOf(session, 'todos')` for the todo list, `ctx.tokenMeter.measure(session).totalTokens` for the size, and `ctx.timeout` for the quiet window. The todo projection is read only after the context enters the soft range, so most turns skip the materialization.

Subagent sessions take the hard path alone.

## Limits

- Compaction works on stable ranges. One oversized message can hold the context above the threshold.
- The `/compact` path decides what stays: the system prompt, one summary, and the last message plus whatever tool-call pairing needs. No setting keeps a longer verbatim tail, because `compactRegion` requires an open turn and this plugin runs while the agent sits idle.
- Each compaction sends one extra model request, billed as normal usage.
- A session whose preset mounts no compaction service gets nothing from this plugin.
- Tested on dsh `0.2.2-rc.5` (Desktop, Windows). The package declares no `engines.dsh`; check compatibility before an upgrade.

## License

MIT. See [LICENSE](LICENSE).
