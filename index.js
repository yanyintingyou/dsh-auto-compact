/**
 * @local/dsh-auto-compact — 回合结束时按需压缩会话历史。
 *
 * 两条路径复用同一个 DSH 压缩服务（等价 `/compact`）：
 *   硬阈值：上下文达到 hardThresholdTokens，回合结束就压。
 *   机会压缩：达到 hardThresholdTokens × softRatio 之后，等一个合适的边界再压——
 *     安静窗口（用户离开 quietWindowMs）或里程碑（goal 标完成 / 待办全清）。
 * 两次压缩之间至少要有 minGrowthTokens 的增长，避免压缩失败后每轮空烧一次摘要请求。
 */

export const name = 'auto-compact'

/** 服务缺席时插件保持不激活，免得取不到值时报错。 */
export const inject = ['tokenMeter', 'agentPresets']

const DEFAULTS = {
  hardThresholdTokens: 500_000,
  softRatio: 0.8,
  quietWindowMs: 1_800_000,
  minGrowthTokens: 60_000,
  boundary: 'both',
  dryRun: false,
}

/** 取一个正数配置值。 */
function positive(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback
}

export function apply(ctx, config = {}) {
  const hard = positive(config.hardThresholdTokens, DEFAULTS.hardThresholdTokens)
  const ratio = positive(config.softRatio, DEFAULTS.softRatio)
  const soft = Math.floor(hard * Math.min(ratio, 1))
  const quietMs = positive(config.quietWindowMs, DEFAULTS.quietWindowMs)
  const growth = typeof config.minGrowthTokens === 'number' && config.minGrowthTokens >= 0
    ? config.minGrowthTokens
    : DEFAULTS.minGrowthTokens
  const boundary = config.boundary === 'quiet' || config.boundary === 'milestone'
    ? config.boundary
    : DEFAULTS.boundary
  const dryRun = config.dryRun === true

  /** 每会话的判定状态；键是 SessionId。 */
  const sessions = new Map()

  function stateOf(agent) {
    let state = sessions.get(agent.id)
    if (state === undefined) {
      state = {
        compactedTokens: 0,   // 上次压缩（或尝试）时的上下文规模
        timer: undefined,     // 安静窗口定时器
        goalComplete: false,  // 上次 idle 时的 goal 状态
        todosDone: false,     // 上次 idle 时的待办状态
        busy: false,
        last: undefined,      // 最近一次决策，给 /autocompact 看
      }
      sessions.set(agent.id, state)
    }
    return state
  }

  const tokensOf = agent => ctx.tokenMeter.measure(agent.session).totalTokens
  const grew = (agent, state) => tokensOf(agent) - state.compactedTokens >= growth

  function cancelTimer(state) {
    if (state.timer !== undefined) {
      state.timer()
      state.timer = undefined
    }
  }

  /** 读 goal 与待办的当前状态，并返回「刚完成」这条边沿。 */
  function takeMilestone(agent, state) {
    let goalComplete = false
    const goals = ctx.get('goals')
    if (goals !== undefined) {
      try {
        goalComplete = goals.get(agent)?.phase === 'complete'
      } catch {
        goalComplete = false
      }
    }
    let todosDone = false
    const projections = ctx.get('sessionProjections')
    if (projections !== undefined) {
      try {
        const todos = projections.stateOf(agent.session, 'todos')
        todosDone = Array.isArray(todos) && todos.length > 0
          && todos.every(item => item?.status === 'completed')
      } catch {
        todosDone = false
      }
    }
    const edge = (goalComplete && !state.goalComplete) || (todosDone && !state.todosDone)
    state.goalComplete = goalComplete
    state.todosDone = todosDone
    return edge
  }

  async function compact(agent, reason, tokens) {
    const state = stateOf(agent)
    if (state.busy) return
    const record = (action, detail = '') => {
      state.last = { at: Date.now(), reason, action, tokens, detail }
    }
    // 子会话只走硬阈值：机会压缩留给用户正在看的顶层会话。
    if (reason !== 'hard' && agent.session.header.parentSession !== undefined) {
      record('skip', 'subagent session')
      return
    }
    const compaction = ctx.agentPresets.serviceFor(agent, 'compaction')
    if (compaction === undefined) {
      record('skip', 'preset mounts no compaction service')
      return
    }
    if (dryRun) {
      record('would-compact')
      return
    }
    state.busy = true
    state.compactedTokens = tokens
    try {
      const result = await compaction.compactNow(agent, new AbortController().signal)
      if (result === null) {
        record('nothing-to-compact')
        return
      }
      record('compacted', `${result.shadowedSeqs.length} 条 / 约 ${result.shadowedTokenCount} tokens`)
      ctx.logger.info(
        `auto-compact (${reason}): compacted ${result.shadowedSeqs.length} history items `
        + `(~${result.shadowedTokenCount} tokens)`,
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      record('failed', message)
      ctx.logger.warn(`auto-compact (${reason}): ${message}`)
    } finally {
      state.busy = false
    }
  }

  function scheduleQuiet(agent, state) {
    if (state.timer !== undefined || typeof ctx.timeout !== 'function') return
    state.timer = ctx.timeout(() => {
      state.timer = undefined
      void fireQuiet(agent)
    }, quietMs)
  }

  async function fireQuiet(agent) {
    const state = stateOf(agent)
    if (state.busy || agent.status !== 'idle') return
    const tokens = tokensOf(agent)
    if (tokens < soft || !grew(agent, state)) return
    await compact(agent, 'quiet', tokens)
  }

  ctx.on('agent/status', ({ agent, status }) => {
    const state = stateOf(agent)
    cancelTimer(state)
    if (status !== 'idle') return

    const tokens = tokensOf(agent)
    const enough = tokens - state.compactedTokens >= growth
    if (!enough) return

    if (tokens >= hard) {
      void compact(agent, 'hard', tokens)
      return
    }
    if (tokens < soft) return

    // 只有进入软区间才读 goal 与待办：投影读取会物化整条会话的投影单元。
    const milestone = takeMilestone(agent, state)
    if (boundary !== 'quiet' && milestone) {
      void compact(agent, 'milestone', tokens)
      return
    }
    if (boundary !== 'milestone') scheduleQuiet(agent, state)
  })

  ctx.on('agent/disposed', ({ agent }) => {
    const state = sessions.get(agent.id)
    if (state !== undefined) cancelTimer(state)
    sessions.delete(agent.id)
  })

  const commands = ctx.get('commands')
  if (commands === undefined) return

  ctx.effect(() => commands.register({
    name: 'autocompact',
    description: '查看自动压缩的阈值、当前上下文与上次决策',
    handler: ({ agent }) => {
      const state = sessions.get(agent.id)
      const tokens = tokensOf(agent)
      const last = state?.last
      const lines = [
        `硬阈值 ${hard} tokens，软阈值 ${soft}（ratio ${ratio}）`,
        `边界 ${boundary}，安静窗口 ${Math.round(quietMs / 60000)} 分钟，增长下限 ${growth} tokens${dryRun ? '，dryRun 已开' : ''}`,
        `当前上下文 ${tokens} tokens，距上次压缩 ${state === undefined ? '-' : tokens - state.compactedTokens}`,
        last === undefined
          ? '本会话还没有判定记录'
          : `上次决策：${last.action}（${last.reason}，${last.tokens} tokens）${last.detail === '' ? '' : ' — ' + last.detail}`,
      ]
      return { kind: 'success', text: lines.join('\n') }
    },
  }))
}
