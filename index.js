/**
 * @local/dsh-auto-compact — 会话上下文达到阈值后，在回合结束（DSH 回复完）时自动压缩历史。
 *
 * 压缩服务挂在每个 agent preset 的隔离组里，Host 端只能用
 * `ctx.agentPresets.serviceFor(agent, 'compaction')` 取到该 agent 的那一份。
 * 阈值与 `/compact`、内建自动压缩读的是同一个估算：
 * `ctx.tokenMeter.measure(session).totalTokens`。
 */

export const name = 'auto-compact'

/** 两个宿主服务都在时才激活，免得取不到服务时抛错。 */
export const inject = ['tokenMeter', 'agentPresets']

/** 默认阈值：50 万 token。 */
const DEFAULT_THRESHOLD = 500_000

export function apply(ctx, config = {}) {
  const threshold = Number.isFinite(config.thresholdTokens) && config.thresholdTokens > 0
    ? config.thresholdTokens
    : DEFAULT_THRESHOLD

  /** 正在压缩的会话，避免同一 agent 重复进入。 */
  const busy = new Set()

  async function compactAtIdle(agent) {
    const compaction = ctx.agentPresets.serviceFor(agent, 'compaction')
    if (compaction === undefined) return
    if (ctx.tokenMeter.measure(agent.session).totalTokens < threshold) return

    // 这一刻 phase 已经回到 idle：compactNow 会同步占住维护位，
    // 新输入排在它后面，不会和压缩抢同一份历史。
    const result = await compaction.compactNow(agent, new AbortController().signal)
    if (result === null) {
      ctx.logger.info('auto-compact: no compactable history yet')
      return
    }
    ctx.logger.info(
      `auto-compact: compacted ${result.shadowedSeqs.length} history items `
      + `(~${result.shadowedTokenCount} tokens)`,
    )
  }

  ctx.on('agent/status', ({ agent, status }) => {
    if (status !== 'idle' || busy.has(agent.id)) return
    busy.add(agent.id)
    void compactAtIdle(agent)
      .catch((error) => {
        ctx.logger.warn(`auto-compact: ${error instanceof Error ? error.message : String(error)}`)
      })
      .finally(() => { busy.delete(agent.id) })
  })
}
