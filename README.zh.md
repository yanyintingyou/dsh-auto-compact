# dsh-auto-compact

[English](README.md) | [中文](README.zh.md)

DeepSeek Harness（dsh）的 Host 端插件：回合结束时，估算的上下文达到阈值就压缩会话历史。效果等同 `/compact`，时机落在没有别的东西占用维护位的那一刻。

## 做什么

每次 agent 从「运行中」回到「空闲」（一轮回复结束）：

1. 用 `ctx.tokenMeter.measure(session).totalTokens` 估算当前上下文；
2. 不足阈值就什么都不做；
3. 达到阈值就对该会话调用 `compaction.compactNow(agent, signal)`。

历史被一条摘要节点替换，产物和 `/compact` 一致。

## 安装

仓库根目录就是插件包根目录，`cordis.patch.yml` 插入一行 `auto-compact`。

1. 把本目录放在一个固定的位置。
2. 在 dsh 里用 `plugin_manager` 的 `install_bundle`，目标填绝对路径；或者 **Plugins → Add plugin** 选择本目录。
3. 装完如果没自动启用，在插件页启用它。

插件没有浏览器端代码，装上不影响页面。

## 阈值

默认 `500000`。改插件行的 config：

```yaml
- id: auto-compact
  name: '@local/dsh-auto-compact'
  config:
    thresholdTokens: 500000
```

## 机制

压缩服务挂在每个 agent preset 的 `compaction` 隔离组里，Host 端用 `ctx.agentPresets.serviceFor(agent, 'compaction')` 取到该会话的那一份。当前 preset 没有挂压缩服务时（例如 `minimal`），静默跳过。

触发点是 `agent/status` 变为 `idle`，即回合真正结束、驱动退出边界那一刻。`compactNow` 在这里同步占住维护位，用户紧接着发的新消息排在压缩之后执行。

压缩会额外发起一次模型请求生成摘要，token 计入正常用量。

关掉插件即回到内建策略：`compaction-basic` 在每一步之前按上下文窗口比例（默认 80%）压缩。

## 限制

- 只压缩到「没有可压缩的稳定区间」为止。超大单条消息撑高的上下文压缩不掉。
- 插件只跑在 Host 端，需要 preset 挂了压缩服务；没挂的会话里它什么都不做。
- 在 dsh `0.2.2-rc.5`（Desktop，Windows）上测试。包没有声明 `engines.dsh`，升级前先确认它和你要用的 dsh 版本相容。

## 许可

MIT，见 [LICENSE](LICENSE)。
