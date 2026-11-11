/**
 * dsh-live-preset — Client half.
 *
 * Draws a compact chip in the composer tool row that shows which Agent preset
 * the open conversation runs, and opens a list of declared presets. Picking one
 * asks the Host half to recompose this session and to log the choice; nothing
 * here mutates session state on its own.
 *
 * The list lives in `conversation.input.overlay`, not inside the chip, because
 * the docked composer clips overflow.
 */

window.__ModuleLoader__.load({
  id: 'dsh-live-preset',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const ROUTE = '/dsh-live-preset'
    const NS = 'dsh-live-preset'

    /**
     * Sub-path deployments: the plugin's own route must carry the same prefix
     * as the bundle URL, otherwise the request lands on the SPA fallback.
     */
    const detectAppBase = (doc, href) => {
      const strip = (value) => String(value || '').replace(/\/+$/, '')
      const fromPath = (value) => {
        const match = /^(.*?)\/plugins\//.exec(String(value || ''))
        return match ? strip(match[1]) : null
      }
      if (!doc) return ''
      try {
        const src = doc.currentScript && doc.currentScript.src
        if (src) {
          const base = fromPath(new URL(src, doc.baseURI || href).pathname)
          if (base !== null) return base
        }
      } catch {
        /* not a browser, or the script element is gone */
      }
      try {
        for (const el of doc.querySelectorAll('script[src]')) {
          const base = fromPath(new URL(el.src, doc.baseURI || href).pathname)
          if (base !== null) return base
        }
      } catch {
        /* minimal DOM */
      }
      try {
        const path = new URL(doc.baseURI).pathname
        if (path.endsWith('/')) return strip(path)
      } catch {
        /* no document.baseURI */
      }
      return ''
    }

    const APP_BASE = detectAppBase(
      typeof document === 'undefined' ? null : document,
      typeof location === 'undefined' ? '' : location.href,
    )

    const absAppPath = (value) => {
      const text = String(value == null ? '' : value)
      if (!text || text[0] !== '/' || text[1] === '/') return text
      if (!APP_BASE || text === APP_BASE || text.indexOf(APP_BASE + '/') === 0) return text
      return APP_BASE + text
    }

    const EN = {
      'chip.label': 'Agent preset',
      'chip.loading': 'Preset…',
      'chip.unknown': 'Preset ?',
      'chip.title': 'Switch this conversation\'s Agent preset',
      'panel.title': 'Agent preset',
      'panel.live': 'live',
      'panel.hint': 'Applies to this conversation from its next turn. The choice is recorded in the session log.',
      'panel.loading': 'Reading the preset roster…',
      'panel.empty': 'No presets are declared in this profile.',
      'panel.brokenBadge': 'broken',
      'panel.switching': 'switching…',
      'panel.busy': 'A turn is still running. Switch again once it finishes.',
      'panel.switched': 'Switched to',
      'panel.unchanged': 'Already on',
      'panel.noSession': 'This session is not loaded, so it has no composition to switch.',
      'panel.unknownPreset': 'That preset is not declared any more.',
      'panel.localOnly': 'Preset control is limited to this machine.',
      'panel.failed': 'Could not switch:',
      'panel.retry': 'Retry',
      'action.close': 'Close',
    }

    const ZH = {
      'chip.label': 'Agent 预设',
      'chip.loading': '预设…',
      'chip.unknown': '预设 ?',
      'chip.title': '切换这个对话的 Agent 预设',
      'panel.title': 'Agent 预设',
      'panel.live': '当前',
      'panel.hint': '从下一轮起生效，切换会记进会话日志。',
      'panel.loading': '正在读取预设列表…',
      'panel.empty': '这个 profile 里还没有声明预设。',
      'panel.brokenBadge': '有错误',
      'panel.switching': '切换中…',
      'panel.busy': '这一轮还在跑，等它结束再切。',
      'panel.switched': '已切换到',
      'panel.unchanged': '本来就在',
      'panel.noSession': '这个会话当前没在运行，没有可切换的组合。',
      'panel.unknownPreset': '这个预设已经不在名单里了。',
      'panel.localOnly': '预设切换只接受本机请求。',
      'panel.failed': '切换失败：',
      'panel.retry': '重试',
      'action.close': '关闭',
    }

    const CSS = [
      '.dlp-chip{display:inline-flex;align-items:center;gap:5px;height:28px;max-width:200px;padding:0 8px;border:1px solid transparent;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;line-height:1;cursor:pointer;transition:background .12s,color .12s}',
      '.dlp-chip:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}',
      '.dlp-chip[data-open="true"]{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-border-l1);color:var(--dsw-alias-label-primary)}',
      '.dlp-chip[data-live="false"]{color:var(--dsw-alias-label-tertiary)}',
      '.dlp-chip-text{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:150px}',
      '.dlp-caret{font-size:9px;color:var(--dsw-alias-label-tertiary)}',
      '.dlp-panel{position:absolute;bottom:calc(100% + 8px);left:8px;z-index:40;box-sizing:border-box;width:min(420px,92vw);max-height:min(52vh,440px);display:flex;flex-direction:column;gap:4px;padding:8px;overflow:auto;background:var(--dsw-alias-bg-overlay);border:1px solid var(--dsw-alias-border-l1);border-radius:14px;box-shadow:0 12px 40px rgba(0,0,0,.28);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px}',
      '.dlp-head{display:flex;align-items:baseline;justify-content:space-between;gap:8px;padding:2px 8px 0}',
      '.dlp-title{font-size:12px;font-weight:600}',
      '.dlp-sub{font-size:11px;color:var(--dsw-alias-label-tertiary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.dlp-hint{margin:0;padding:0 8px 6px;font-size:11px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}',
      '.dlp-row{display:block;width:100%;box-sizing:border-box;text-align:left;padding:7px 8px;border:1px solid transparent;border-radius:10px;background:transparent;color:inherit;font:inherit;cursor:pointer}',
      '.dlp-row:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2)}',
      '.dlp-row[data-current="true"]{border-color:var(--dsw-alias-brand-primary);background:var(--dsw-alias-bg-layer-2)}',
      '.dlp-row:disabled{cursor:default;opacity:.6}',
      '.dlp-row[data-current="true"]:disabled{opacity:1}',
      '.dlp-row-name{display:flex;align-items:center;gap:6px;font-weight:600}',
      '.dlp-row-id{display:block;font-size:11px;color:var(--dsw-alias-label-tertiary);margin-top:1px}',
      '.dlp-desc{display:block;font-size:11px;line-height:1.45;color:var(--dsw-alias-label-secondary);margin-top:2px}',
      '.dlp-dot{width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-brand-primary);flex:none}',
      '.dlp-badge{flex:none;padding:0 5px;border:1px solid var(--dsw-alias-border-l2);border-radius:999px;font-size:10px;line-height:15px;font-weight:400;color:var(--dsw-alias-label-secondary)}',
      '.dlp-badge[data-kind="error"]{color:var(--dsw-alias-state-error-primary);border-color:var(--dsw-alias-state-error-primary)}',
      '.dlp-note{margin:2px 8px 0;padding:5px 8px;border-radius:8px;font-size:11px;line-height:1.45;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary)}',
      '.dlp-note[data-kind="ok"]{color:var(--dsw-alias-state-success-primary)}',
      '.dlp-note[data-kind="error"]{color:var(--dsw-alias-state-error-primary)}',
      '.dlp-note[data-kind="info"]{color:var(--dsw-alias-label-secondary)}',
      '.dlp-foot{display:flex;justify-content:flex-end;padding:2px 4px 0}',
      '.dlp-link{border:none;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:11px;cursor:pointer;padding:4px 6px;border-radius:6px}',
      '.dlp-link:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}',
    ].join('\n')

    /** One JSON call to the Host half. */
    async function api(params, method) {
      const url = absAppPath(ROUTE)
      const init =
        method === 'POST'
          ? {
              method: 'POST',
              headers: { 'content-type': 'application/json', accept: 'application/json' },
              body: JSON.stringify(params),
              credentials: 'same-origin',
            }
          : {
              headers: { accept: 'application/json' },
              credentials: 'same-origin',
            }
      const target = method === 'POST' ? url : url + '?' + new URLSearchParams(params).toString()
      const response = await fetch(target, init)
      let body = null
      try {
        body = await response.json()
      } catch {
        body = null
      }
      if (!response.ok || body === null || body.ok !== true) {
        const error = new Error((body && body.message) || 'HTTP ' + response.status)
        error.code = body && body.code
        throw error
      }
      return body
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        const slots = ctx.get('slots')
        if (slots === undefined) return

        const locale = ctx.get('locale')

        // Dictionaries go through the locale service so the chip follows the
        // active language like every other plugin surface.
        const translate = locale
          ? (() => {
              try {
                const disposeEn = locale.register(NS, 'en', EN)
                const disposeZh = locale.register(NS, 'zh', ZH)
                ctx.effect(() => () => {
                  disposeEn()
                  disposeZh()
                })
              } catch (error) {
                ctx.logger?.warn?.(`dsh-live-preset: locale registration failed: ${String(error)}`)
              }
              const bound = locale.bind(NS)
              return (key) => {
                const text = bound(key)
                return text === key ? (EN[key] ?? key) : text
              }
            })()
          : (key) => EN[key] ?? key

        const t = translate
        const noSubscription = () => () => {}
        const useLocaleRevision = () =>
          React.useSyncExternalStore(
            locale ? (listener) => locale.subscribe(listener) : noSubscription,
            locale ? () => locale.getSnapshot().revision : () => 0,
            () => 0,
          )

        // ---- controller: one small store shared by the chip and the list ----
        let state = {
          open: false,
          sessionId: null,
          phase: 'idle',
          presets: [],
          status: null,
          live: true,
          message: null,
          pending: null,
          error: null,
        }
        const listeners = new Set()
        let loadToken = 0

        const put = (patch) => {
          state = { ...state, ...patch }
          for (const listener of listeners) listener()
        }

        const localizedError = (error) => {
          const code = error && error.code
          if (code === 'turn-running') return t('panel.busy')
          if (code === 'session-not-live') return t('panel.noSession')
          if (code === 'preset-unknown') return t('panel.unknownPreset')
          if (code === 'not-loopback') return t('panel.localOnly')
          if (code === 'preset-broken') {
            return t('panel.failed') + ' ' + (error && error.message ? error.message : '')
          }
          return t('panel.failed') + ' ' + (error && error.message ? error.message : String(error))
        }

        const controller = {
          subscribe(listener) {
            listeners.add(listener)
            return () => listeners.delete(listener)
          },
          getState() {
            return state
          },
          async load(sessionId) {
            if (!sessionId) return
            const token = ++loadToken
            put({ sessionId, phase: 'loading', error: null })
            try {
              const body = await api({ action: 'status', sessionId })
              if (token !== loadToken) return
              put({
                phase: 'ready',
                live: body.live !== false,
                presets: Array.isArray(body.presets) ? body.presets : [],
                status: body.status ?? null,
              })
            } catch (error) {
              if (token !== loadToken) return
              put({ phase: 'error', error, live: false })
            }
          },
          observe(sessionId) {
            if (!sessionId) return
            if (state.sessionId === sessionId && (state.phase === 'loading' || state.phase === 'ready')) return
            void controller.load(sessionId)
          },
          toggle(sessionId) {
            if (state.open) {
              put({ open: false })
              return
            }
            put({ open: true, sessionId, message: null })
            void controller.load(sessionId)
          },
          close() {
            if (!state.open) return
            put({ open: false })
          },
          async choose(presetId) {
            const sessionId = state.sessionId
            if (!sessionId || state.pending) return
            put({ pending: presetId, message: null, error: null })
            try {
              const body = await api({ action: 'switch', sessionId, agentPreset: presetId }, 'POST')
              put({
                pending: null,
                phase: 'ready',
                live: true,
                presets: Array.isArray(body.presets) ? body.presets : state.presets,
                status: body.status ?? state.status,
                message: {
                  kind: 'ok',
                  text: (body.changed ? t('panel.switched') : t('panel.unchanged')) + ' ' + (body.preset || presetId),
                },
              })
            } catch (error) {
              const busy = error && error.code === 'turn-running'
              put({
                pending: null,
                error,
                message: { kind: 'error', text: localizedError(error) },
                status: busy && state.status ? { ...state.status, busy: true } : state.status,
              })
            }
          },
        }

        const useStore = () => React.useSyncExternalStore(controller.subscribe, controller.getState, controller.getState)

        const nameOf = (presets, id) => {
          if (!id) return null
          const row = presets.find((item) => item.id === id)
          return row && row.name ? row.name : id
        }

        const glyph = (size) =>
          h(
            'svg',
            {
              viewBox: '0 0 24 24',
              width: size,
              height: size,
              fill: 'none',
              stroke: 'currentColor',
              strokeWidth: 1.8,
              strokeLinecap: 'round',
              'aria-hidden': true,
            },
            [
              h('rect', { key: 'a', x: 3.5, y: 4, width: 17, height: 5, rx: 2.5 }),
              h('rect', { key: 'b', x: 3.5, y: 11.5, width: 11, height: 5, rx: 2.5 }),
              h('path', { key: 'c', d: 'M16 18h4.5m0 0-1.7-1.7m1.7 1.7-1.7 1.7' }),
            ],
          )

        function PresetChip(props) {
          const sessionId = props.sessionId
          const snapshot = useStore()
          useLocaleRevision()

          React.useEffect(() => {
            controller.observe(sessionId)
          }, [sessionId])

          if (!sessionId) return null

          const current = snapshot.status && snapshot.status.live ? snapshot.status.live : null
          const label =
            current === null
              ? snapshot.phase === 'loading'
                ? t('chip.loading')
                : t('chip.unknown')
              : nameOf(snapshot.presets, current)

          const title = [t('chip.title'), current === null ? '' : current].filter(Boolean).join(' · ')

          return h(
            'button',
            {
              type: 'button',
              className: 'dlp-chip',
              'data-dlp-root': '1',
              'data-open': snapshot.open ? 'true' : 'false',
              'data-live': snapshot.live ? 'true' : 'false',
              title,
              'aria-label': title,
              'aria-haspopup': 'dialog',
              'aria-expanded': snapshot.open ? 'true' : 'false',
              onClick: () => controller.toggle(sessionId),
            },
            [
              h('span', { key: 'g', style: { display: 'inline-flex', flex: 'none' } }, glyph(14)),
              h('span', { key: 't', className: 'dlp-chip-text' }, label),
              h('span', { key: 'c', className: 'dlp-caret', 'aria-hidden': true }, '▾'),
            ],
          )
        }

        function PresetPanel(props) {
          const sessionId = props.sessionId
          const snapshot = useStore()
          useLocaleRevision()

          const open = snapshot.open

          React.useEffect(() => {
            if (!open) return undefined
            const onKeyDown = (event) => {
              if (event.key === 'Escape') {
                event.stopPropagation()
                controller.close()
              }
            }
            const onPointerDown = (event) => {
              const target = event.target
              if (target instanceof Element && target.closest('[data-dlp-root="1"]')) return
              controller.close()
            }
            document.addEventListener('keydown', onKeyDown, true)
            document.addEventListener('pointerdown', onPointerDown, true)
            return () => {
              document.removeEventListener('keydown', onKeyDown, true)
              document.removeEventListener('pointerdown', onPointerDown, true)
            }
          }, [open])

          React.useEffect(() => {
            if (open && sessionId && snapshot.sessionId !== sessionId) {
              put({ sessionId, open: true })
              void controller.load(sessionId)
            }
          }, [open, sessionId, snapshot.sessionId])

          if (!open) return null

          const current = snapshot.status && snapshot.status.live ? snapshot.status.live : null
          const rows = snapshot.presets

          const children = [
            h(
              'div',
              { key: 'head', className: 'dlp-head' },
              [
                h('span', { key: 'title', className: 'dlp-title' }, t('panel.title')),
                h(
                  'span',
                  { key: 'sub', className: 'dlp-sub' },
                  current === null ? '' : t('panel.live') + ' · ' + current,
                ),
              ],
            ),
            h('p', { key: 'hint', className: 'dlp-hint' }, t('panel.hint')),
          ]

          if (rows.length === 0) {
            children.push(h('p', { key: 'empty', className: 'dlp-note', 'data-kind': 'info' }, t('panel.empty')))
          }

          for (const row of rows) {
            const isCurrent = current === row.id
            const isPending = snapshot.pending === row.id
            children.push(
              h(
                'button',
                {
                  key: 'row:' + row.id,
                  type: 'button',
                  className: 'dlp-row',
                  'data-current': isCurrent ? 'true' : 'false',
                  disabled: isCurrent || Boolean(row.broken) || snapshot.pending !== null,
                  title: row.broken ? row.broken : row.id,
                  onClick: () => {
                    void controller.choose(row.id)
                  },
                },
                [
                  h(
                    'span',
                    { key: 'name', className: 'dlp-row-name' },
                    [
                      isCurrent ? h('span', { key: 'dot', className: 'dlp-dot' }) : null,
                      h('span', { key: 'label' }, row.name || row.id),
                      row.broken
                        ? h('span', { key: 'bad', className: 'dlp-badge', 'data-kind': 'error' }, t('panel.brokenBadge'))
                        : null,
                      isPending ? h('span', { key: 'wait', className: 'dlp-badge' }, t('panel.switching')) : null,
                    ],
                  ),
                  h('span', { key: 'id', className: 'dlp-row-id' }, row.id),
                  row.description ? h('span', { key: 'desc', className: 'dlp-desc' }, row.description) : null,
                ],
              ),
            )
          }

          if (snapshot.status && snapshot.status.busy) {
            children.push(h('p', { key: 'busy', className: 'dlp-note', 'data-kind': 'info' }, t('panel.busy')))
          }
          if (snapshot.phase === 'loading') {
            children.push(h('p', { key: 'load', className: 'dlp-note', 'data-kind': 'info' }, t('panel.loading')))
          }
          if (snapshot.phase === 'error' && snapshot.error) {
            children.push(
              h('p', { key: 'err', className: 'dlp-note', 'data-kind': 'error' }, localizedError(snapshot.error)),
            )
            children.push(
              h(
                'div',
                { key: 'retry', className: 'dlp-foot' },
                [
                  h(
                    'button',
                    {
                      key: 'retry',
                      type: 'button',
                      className: 'dlp-link',
                      onClick: () => {
                        void controller.load(snapshot.sessionId || sessionId)
                      },
                    },
                    t('panel.retry'),
                  ),
                ],
              ),
            )
          }
          if (snapshot.message) {
            children.push(
              h('p', { key: 'msg', className: 'dlp-note', 'data-kind': snapshot.message.kind }, snapshot.message.text),
            )
          }

          children.push(
            h(
              'div',
              { key: 'foot', className: 'dlp-foot' },
              [
                h(
                  'button',
                  { key: 'close', type: 'button', className: 'dlp-link', onClick: () => controller.close() },
                  t('action.close'),
                ),
              ],
            ),
          )

          return h(
            'div',
            {
              className: 'dlp-panel',
              role: 'dialog',
              'aria-label': t('panel.title'),
              'data-dlp-root': '1',
            },
            children,
          )
        }

        ctx.effect(() => {
          const style = document.createElement('style')
          style.id = 'dsh-live-preset-style'
          style.textContent = CSS
          document.head.appendChild(style)
          return () => {
            style.remove()
          }
        }, 'dsh-live-preset: styles')

        slots.inject('conversation.input.left', () =>
          slots.register(
            {
              name: 'conversation.input.left',
              id: 'live-preset',
              order: 6,
              label: () => t('chip.label'),
            },
            (props) => React.createElement(PresetChip, props),
          ),
        )

        slots.inject('conversation.input.overlay', () =>
          slots.register(
            {
              name: 'conversation.input.overlay',
              id: 'live-preset',
              order: 6,
              label: () => t('panel.title'),
            },
            (props) => React.createElement(PresetPanel, props),
          ),
        )
      },
    }
  },
})
