/**
 * dsh-live-preset — Host half.
 *
 * The shipped Agent-preset picker only accepts a choice while the session is
 * still blank (`agentPresets.select` refuses once a turn has run). This plugin
 * performs the same operation after the conversation has started:
 *
 *   recompose the live Agent onto another preset revision, then record the
 *   choice with the very same `agent-preset/selected` event the blank-session
 *   picker appends.
 *
 * Because the change is logged, the session projection, a later resume and a
 * fork all agree with the composition the model actually ran under. Because it
 * is refused while a turn is open, no request is ever assembled from one
 * half-swapped composition.
 *
 * Two callers share one operation:
 *   - the Web composer chip, through the local HTTP route below;
 *   - the `/preset` slash command, through the command registry.
 */

/** Exact path of the local control route. */
const ROUTE = '/dsh-live-preset'

/** Largest accepted request body. */
const BODY_LIMIT = 64 * 1024

export const inject = ['agentPresets', 'agents', 'webServer']

/**
 * Presets whose agents may not switch themselves. Guarded channels (the QQ
 * bridge presets) are reached by strangers, so a self-switch there would be an
 * escalation path from a prompt injection straight into the unguarded tools.
 * The user can still switch them with the chip or `/preset`.
 */
const DEFAULT_GUARDED_PRESETS = ['qq-chat', 'qq-chat-v2']

/** A refusal with an HTTP status and a stable, client-localizable code. */
class HttpError extends Error {
  constructor(status, code, message) {
    super(message)
    this.status = status
    this.code = code
  }
}

/** Whether a socket or URL host name addresses this machine. */
function isLoopbackName(value) {
  if (typeof value !== 'string' || value === '') return false
  const host = value.startsWith('::ffff:') ? value.slice(7) : value
  if (host === '::1' || host === 'localhost') return true
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)
}

/** Write one JSON response and end it. */
function sendJson(res, status, body) {
  const text = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(text),
  })
  res.end(text)
}

/** Collect and parse a bounded JSON request body. */
function readJsonBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) {
        reject(new HttpError(413, 'body-too-large', 'Request body is too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (chunks.length === 0) {
        resolve({})
        return
      }
      try {
        const text = Buffer.concat(chunks).toString('utf8').replace(/^\uFEFF/, '')
        const parsed = JSON.parse(text)
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
          reject(new HttpError(400, 'bad-json', 'Request body must be a JSON object'))
          return
        }
        resolve(parsed)
      } catch {
        reject(new HttpError(400, 'bad-json', 'Request body is not valid JSON'))
      }
    })
    req.on('error', (error) => reject(error))
  })
}

/** Read the roster as plain JSON. */
function rosterOf(agentPresets) {
  return agentPresets.list().then((rows) =>
    rows.map((row) => ({
      id: row.id,
      name: row.name ?? null,
      description: row.description ?? null,
      broken: row.broken ?? null,
    })),
  )
}

export function apply(ctx, config) {
  /** Presets that refuse an agent-initiated switch; the row's `config` may extend this. */
  const guarded = Array.isArray(config?.guardPresets)
    ? config.guardPresets.map((value) => String(value))
    : DEFAULT_GUARDED_PRESETS
  const isGuarded = (presetId) => presetId !== null && guarded.includes(presetId)

  /** Per-session switch queue: two clicks must not interleave two rebinds. */
  const queues = new Map()

  const agentPresets = () => ctx.agentPresets
  const agents = () => ctx.agents

  /** Run `task` after every previously queued task for one session. */
  function serialized(sessionId, task) {
    const previous = queues.get(sessionId) ?? Promise.resolve()
    const next = previous.then(task, task)
    const guard = next.then(
      () => undefined,
      () => undefined,
    )
    queues.set(sessionId, guard)
    guard.then(() => {
      if (queues.get(sessionId) === guard) queues.delete(sessionId)
    })
    return next
  }

  /** Read what one live Agent runs, and whether a turn is in flight. */
  function statusOf(agent) {
    const boundary = agents().turnBoundaryOf(agent.session)
    return {
      sessionId: agent.id,
      live: agentPresets().composedPreset(agent.ctx) ?? null,
      recorded: agentPresets().presetForSession(agent.session) ?? null,
      busy: boundary.openTurnStartSeq !== null,
      turns: boundary.lastTurn,
    }
  }

  /** Composed preset of an Agent, or null when it is not bound to one. */
  function composedOf(agent) {
    try {
      return agentPresets().composedPreset(agent?.ctx) ?? null
    } catch {
      return null
    }
  }

  /**
   * Move one live Agent to another preset revision and log the choice.
   * @param options.allowMidTurn true only for the agent's own tool call: it runs
   *   inside a turn, and expects the next step to read the new composition.
   * @returns the new identity, the previous one, and whether anything moved.
   */
  async function switchPreset(sessionId, agentPreset, options) {
    if (typeof sessionId !== 'string' || sessionId === '') {
      throw new HttpError(400, 'bad-request', 'sessionId is required')
    }
    if (typeof agentPreset !== 'string' || agentPreset === '') {
      throw new HttpError(400, 'bad-request', 'agentPreset is required')
    }
    const agent = agents().get(sessionId)
    if (agent === undefined) {
      throw new HttpError(409, 'session-not-live', 'This session is not loaded, so it has no live composition to switch')
    }
    const boundary = agents().turnBoundaryOf(agent.session)
    if (boundary.openTurnStartSeq !== null && options?.allowMidTurn !== true) {
      throw new HttpError(409, 'turn-running', 'A turn is still running; switch again once it finishes')
    }
    const rows = await rosterOf(agentPresets())
    const target = rows.find((row) => row.id === agentPreset)
    if (target === undefined) {
      throw new HttpError(404, 'preset-unknown', `Unknown agent preset: ${agentPreset}`)
    }
    if (target.broken) {
      throw new HttpError(400, 'preset-broken', target.broken)
    }
    const before = agentPresets().composedPreset(agent.ctx) ?? null
    const recorded = agentPresets().presetForSession(agent.session) ?? null
    if (before === agentPreset && recorded === agentPreset) {
      return { changed: false, preset: agentPreset, previous: before }
    }
    const preset = await agentPresets().recompose(agent.ctx, agentPreset)
    try {
      agent.session.append('agent-preset/selected', { agentPreset: preset.id })
    } catch (error) {
      // The composition moved but the log did not. Put it back, so a resume
      // never disagrees with what the model actually saw.
      if (before !== null) {
        try {
          await agentPresets().recompose(agent.ctx, before)
        } catch (undo) {
          ctx.logger?.warn?.(`dsh-live-preset: could not restore preset ${before} for ${sessionId}: ${String(undo)}`)
        }
      }
      throw new HttpError(500, 'switch-failed', `Could not record the preset change: ${String(error)}`)
    }
    ctx.logger?.info?.(`dsh-live-preset: ${sessionId} switched ${before ?? 'none'} -> ${preset.id}`)
    return { changed: true, preset: preset.id, previous: before }
  }

  /** Answer one control request. */
  async function handle(req, res) {
    if (!isLoopbackName(req.socket?.remoteAddress ?? '')) {
      sendJson(res, 403, { ok: false, code: 'not-loopback', message: 'Only this machine may control a session preset' })
      return
    }
    const origin = req.headers.origin
    if (typeof origin === 'string' && origin !== '' && origin !== 'null') {
      let host = ''
      try {
        host = new URL(origin).hostname
      } catch {
        host = ''
      }
      if (!isLoopbackName(host)) {
        sendJson(res, 403, { ok: false, code: 'not-loopback', message: 'Cross-origin preset control is refused' })
        return
      }
    }

    const url = new URL(req.url ?? '/', 'http://localhost')
    let action = url.searchParams.get('action') ?? ''
    let sessionId = url.searchParams.get('sessionId') ?? ''
    let agentPreset = url.searchParams.get('agentPreset') ?? ''
    if (req.method === 'POST') {
      const body = await readJsonBody(req, BODY_LIMIT)
      if (typeof body.action === 'string') action = body.action
      if (typeof body.sessionId === 'string') sessionId = body.sessionId
      if (typeof body.agentPreset === 'string') agentPreset = body.agentPreset
    } else if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { allow: 'GET, POST', 'content-type': 'text/plain; charset=utf-8' })
      res.end('method not allowed')
      return
    }

    if (action === 'list') {
      sendJson(res, 200, {
        ok: true,
        default: agentPresets().defaultId ?? null,
        presets: await rosterOf(agentPresets()),
      })
      return
    }

    if (action === 'status') {
      const agent = agents().get(sessionId)
      if (agent === undefined) {
        // Nothing is composed for a session that is not loaded, so there is
        // nothing to switch and nothing trustworthy to report.
        sendJson(res, 200, {
          ok: true,
          live: false,
          status: { sessionId, live: null, recorded: null, busy: false, turns: 0 },
          presets: await rosterOf(agentPresets()),
        })
        return
      }
      sendJson(res, 200, {
        ok: true,
        live: true,
        status: statusOf(agent),
        presets: await rosterOf(agentPresets()),
      })
      return
    }

    if (action === 'switch') {
      // A state change must never be reachable by navigation: a plain GET can be
      // issued by any page on this machine through an <img> or <link>.
      if (req.method !== 'POST') {
        throw new HttpError(405, 'bad-method', 'A preset switch must be POSTed')
      }
      const result = await serialized(sessionId, () => switchPreset(sessionId, agentPreset))
      const agent = agents().get(sessionId)
      sendJson(res, 200, {
        ok: true,
        ...result,
        status: agent === undefined ? null : statusOf(agent),
        presets: await rosterOf(agentPresets()),
      })
      return
    }

    throw new HttpError(400, 'bad-request', 'action must be one of: list, status, switch')
  }

  ctx.effect(() =>
    ctx.webServer.register({
      kind: 'exact',
      path: ROUTE,
      async handler(req, res) {
        try {
          await handle(req, res)
        } catch (error) {
          const status = error instanceof HttpError ? error.status : 500
          const code = error instanceof HttpError ? error.code : 'internal'
          const message = error instanceof Error ? error.message : String(error)
          if (!res.headersSent) sendJson(res, status, { ok: false, code, message })
          else res.end()
        }
      },
    }),
  )

  // The same operation, as a slash command. Registered only when this profile
  // actually composes a command registry.
  ctx.inject(['commands'], (child) => {
    child.effect(() =>
      child.commands.register({
        name: 'preset',
        description: "Show or switch this conversation's Agent preset after it has started.",
        input: { hint: '[preset id]' },
        handler: async (invocation) => {
          const wanted = String(invocation.rawInput ?? '').trim()
          const agent = invocation.agent
          if (wanted === '') {
            const status = statusOf(agent)
            const rows = await rosterOf(agentPresets())
            const lines = rows.map((row) => {
              const mark = row.id === status.live ? '*' : ' '
              const label = row.name === null ? '' : ` — ${row.name}`
              const broken = row.broken ? ' (broken)' : ''
              return `${mark} ${row.id}${label}${broken}`
            })
            return {
              kind: 'success',
              text: [`current: ${status.live ?? 'none'}`, ...lines].join('\n'),
            }
          }
          try {
            const result = await serialized(agent.id, () => switchPreset(agent.id, wanted))
            return {
              kind: 'success',
              text: result.changed ? `Switched to ${result.preset}` : `Already on ${result.preset}`,
            }
          } catch (error) {
            return { kind: 'error', text: error instanceof Error ? error.message : String(error) }
          }
        },
      }),
    )
  })

  // The agent's own switch. Unlike the chip and `/preset` this one may act
  // inside a turn: the call belongs to the loop, and the next step reads the
  // new composition. Guarded presets never expose it, so a channel reached by
  // strangers cannot be talked into granting itself tools.
  ctx.inject(['tools'], (child) => {
    child.effect(() =>
      child.tools.register(
        {
          name: 'agent_preset',
          description:
            "Switch this conversation's Agent preset — the composition of tools, prompt sections and skills it runs. " +
            "action=list shows the roster and the one in effect; action=switch moves to the given preset id. " +
            'A switch is recorded in the session log, so a later resume or fork keeps it. ' +
            'It changes your own tool list and system prompt from the next step and can take capabilities away from you, ' +
            'so pick deliberately. Do not use it to obtain capabilities this channel was not given: ' +
            'guarded presets refuse, and only the user can change those.',
          parameters: {
            type: 'object',
            properties: {
              action: {
                type: 'string',
                enum: ['list', 'switch'],
                description: 'list the presets, or switch to one.',
              },
              preset: {
                type: 'string',
                description: 'Preset id to switch to. Required for action=switch.',
              },
            },
            required: ['action'],
          },
          output: {
            schema: { type: 'object', additionalProperties: true },
            render: (_args, value) => [
              { type: 'text', text: String(value && value.message !== undefined ? value.message : '') },
            ],
          },
          async execute(args, exec) {
            const agent = exec.agent
            if (agent === undefined) throw new Error('agent_preset needs a calling agent')
            const action = typeof args?.action === 'string' ? args.action : ''
            const current = statusOf(agent)
            if (isGuarded(current.live)) {
              throw new Error(
                `Preset ${current.live} does not allow the agent to switch itself; only the user can change it here`,
              )
            }
            if (action === 'list') {
              const rows = await rosterOf(agentPresets())
              const lines = rows.map((row) => {
                const mark = row.id === current.live ? '*' : ' '
                const label = row.name === null ? '' : ` — ${row.name}`
                const broken = row.broken ? ' (broken, cannot be used)' : ''
                const guardedMark = isGuarded(row.id) ? ' [guarded]' : ''
                return `${mark} ${row.id}${label}${broken}${guardedMark}`
              })
              return {
                ok: true,
                current: current.live,
                selfSwitch: true,
                presets: rows.map((row) => row.id),
                message: [`Agent preset in effect: ${current.live ?? 'none'}`, ...lines].join('\n'),
              }
            }
            if (action !== 'switch') throw new Error("action must be 'list' or 'switch'")
            const wanted = typeof args?.preset === 'string' ? args.preset.trim() : ''
            if (wanted === '') throw new Error('action=switch needs a preset id')
            const result = await serialized(agent.id, () =>
              switchPreset(agent.id, wanted, { allowMidTurn: true }),
            )
            const after = statusOf(agent)
            return {
              ok: true,
              changed: result.changed,
              previous: result.previous,
              preset: result.preset,
              message: result.changed
                ? `Switched ${result.previous ?? 'none'} -> ${result.preset}. Your tool list and system prompt come from ${result.preset} starting with the next step.`
                : `Already on ${result.preset}; nothing changed.`,
            }
          },
        },
        {
          // Hide the tool where it would refuse, instead of advertising a
          // capability the channel deliberately does not have.
          when: (context) => !isGuarded(composedOf(context.agent)),
        },
      ),
    )
  })
}
