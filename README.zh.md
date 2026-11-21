# dsh-auto-compact

[English](README.md) | [中文](README.zh.md)

DeepSeek Harness 的 Host 端插件。每轮回复结束时检查一次上下文：到硬阈值就直接压，到软阈值就等一个合适的时机再压。压缩调用会话 preset 自带的压缩服务，产物和 `/compact` 一样。

## 做什么

agent 从「运行中」回到「空闲」时，插件按顺序判断：

1. 距上次压缩的增长不到 `minGrowthTokens`（默认 100000），本轮不做任何事。
2. 上下文达到 `hardThresholdTokens`（默认 500000），立刻压。
3. 上下文达到软阈值（硬阈值 × `softRatio`，默认 0.8，即 400000），看边界：
   - `quiet`：`quietWindowMs`（默认 30 分钟）内没有新输入就压；
   - `milestone`：会话里的 goal 刚标成 `complete`，或者待办刚全部完成；
   - `both`（默认）：两者谁先到算谁。
4. 低于软阈值，本轮不压。

两次压缩之间至少要涨 `minGrowthTokens`。这道闸门挡三种情况：压缩没能把上下文降下来、压缩失败、进程重启后判定状态清空。没有它，这几种情况会在每轮结束时各发一次摘要请求。

## 安装

仓库根目录就是包根目录，`cordis.patch.yml` 插入一行 `auto-compact`。

1. 把本目录放在固定位置。
2. 在 dsh 里用 `plugin_manager` 的 `install_bundle`，目标填绝对路径；或者 **Plugins → Add plugin** 选择本目录。
3. 装完没有自动启用，就在插件页启用。

插件没有浏览器端代码，页面不会变化。

## 配置

```yaml
- id: auto-compact
  name: '@local/dsh-auto-compact'
  config:
    hardThresholdTokens: 500000   # 硬阈值
    softRatio: 0.8                # 软阈值 = 硬阈值 × 0.8
    quietWindowMs: 1800000        # 安静窗口，30 分钟
    minGrowthTokens: 100000       # 两次压缩之间的最小增长
    boundary: both                # quiet | milestone | both
    dryRun: false                 # true 时只记录决策，不压缩
```

改硬阈值，软阈值按比例跟着走。

`/autocompact` 回显这些阈值、当前上下文规模、距上次压缩的增长量，以及本会话最近一次判定：`compacted`、`would-compact`、`nothing-to-compact`、`skip`、`failed`，附原因。

## 机制

压缩服务挂在每个 agent preset 的 `compaction` 隔离组里。Host 端用 `ctx.agentPresets.serviceFor(agent, 'compaction')` 取到该会话的那一份。preset 没挂压缩服务时（例如 `minimal`）跳过。

触发点是 `agent/status` 变 `idle`。这一刻 `compactNow` 同步占住维护位，用户紧接着发的消息排在压缩后面执行。

判定只读公开接口：goal 状态取 `ctx.goals.get(agent)` 的 `phase`，待办取 `sessionProjections.stateOf(session, 'todos')`，上下文规模取 `ctx.tokenMeter.measure(session).totalTokens`，安静窗口用 `ctx.timeout`。待办投影只在进入软区间后读取，避免每轮都物化一遍投影。

子会话只走硬阈值，机会压缩留给顶层会话。

压缩请求的输入就是被压掉的那段历史。安静窗口触发时，上一次请求的前缀缓存多半已经过期，摘要按冷输入计价；里程碑触发紧跟在回合结束之后，通常还能吃到热缓存。要省 token 靠里程碑，要避开等摘要的延迟就用安静窗口。

## 限制

- 压缩只处理稳定区间。单条超大消息撑高的上下文压不掉。
- 压缩保留什么由 `/compact` 那个入口决定：系统提示词、一条摘要、最后一条消息，加工具调用配对需要的余量。没有「保留最近若干 token 原文」的开关，`compactRegion` 要求调用时有打开的回合，idle 阶段用不了。
- 每次压缩多发一次模型请求，token 计入正常用量。
- preset 没挂压缩服务的会话里，这个插件什么都不做。
- 在 dsh `0.2.2-rc.5`（Desktop，Windows）上测试。包没有声明 `engines.dsh`，升级前先确认版本相容。

## 许可

MIT，见 [LICENSE](LICENSE)。
