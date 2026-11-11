/**
 * Host half of Completion Alerts.
 *
 * Windows drops every toast this app raises: the desktop shell never declares
 * an AppUserModelID. The browser half therefore posts each finished conversation
 * to this Host, which draws its own Codex-style card with Windows' own drawing
 * APIs. Clicking the card brings the app forward and reports the click back, so
 * the page can open that conversation.
 */
import { spawn } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const TOAST_ROUTE = '/completion-notify/toast'
const PING_ROUTE = '/completion-notify/ping'
const CLICK_ROUTE = '/completion-notify/click'
const PENDING_ROUTE = '/completion-notify/pending'

const SCRIPT_URL = new URL('./toast.ps1', import.meta.url)

/** Last assistant text per session, so the card can quote the answer. */
const lastAnswers = new Map()

function rememberAnswer(sessionId, text) {
  if (typeof sessionId !== 'string' || sessionId === '') return
  lastAnswers.delete(sessionId)
  lastAnswers.set(sessionId, text)
  while (lastAnswers.size > 60) {
    const oldest = lastAnswers.keys().next()
    if (oldest.done === true) break
    lastAnswers.delete(oldest.value)
  }
}

function collectText(value, out, depth) {
  if (depth > 8 || value === null || value === undefined) return
  if (Array.isArray(value)) {
    for (const item of value) collectText(item, out, depth + 1)
    return
  }
  if (typeof value !== 'object') return
  if (value.type === 'text' && typeof value.text === 'string') {
    out.push(value.text)
    return
  }
  for (const [key, item] of Object.entries(value)) {
    if (key === 'text' || key === 'reasoning' || key === 'thinking' || key === 'signature') continue
    collectText(item, out, depth + 1)
  }
}

function snippetOf(event) {
  const data = event?.data
  const out = []
  collectText(data?.message?.content ?? data?.content ?? data, out, 0)
  const text = out.join(' ').replace(/\s+/g, ' ').trim()
  if (text === '') return ''
  return text.length > 160 ? text.slice(0, 157) + '…' : text
}

let scriptPath

function ensureScript() {
  if (scriptPath !== undefined) return scriptPath
  const directory = join(tmpdir(), 'dsh-completion-notify')
  mkdirSync(directory, { recursive: true })
  const file = join(directory, 'card.ps1')
  writeFileSync(file, readFileSync(SCRIPT_URL, 'utf8'), 'utf8')
  scriptPath = file
  return file
}

function powershellPath() {
  const root = process.env.SystemRoot ?? 'C:\\Windows'
  return join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
}

function encode(text) {
  return Buffer.from(String(text ?? ''), 'utf8').toString('base64')
}

/** Append one diagnostic line; a missing log never breaks a route. */
function logEvent(line) {
  try {
    const directory = join(tmpdir(), 'dsh-completion-notify')
    mkdirSync(directory, { recursive: true })
    appendFileSync(join(directory, 'events.log'), `${new Date().toISOString()} ${line}\n`, 'utf8')
  } catch (error) {
    /* diagnostics only */
  }
}

function showCard(card) {
  let file
  try {
    file = ensureScript()
  } catch (error) {
    logEvent(`script error: ${error.message}`)
    return false
  }
  try {
    const directory = join(tmpdir(), 'dsh-completion-notify')
    const errorLog = openSync(join(directory, 'helper.err.log'), 'a')
    const child = spawn(
      powershellPath(),
      [
        '-NoProfile',
        '-WindowStyle',
        'Hidden',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        file,
        '-MetaB64',
        encode(card.meta),
        '-TitleB64',
        encode(card.title),
        '-BodyB64',
        encode(card.detail),
        '-SessionId',
        card.sessionId ?? '',
        '-BaseUrl',
        card.baseUrl ?? '',
        '-Dark',
        card.dark === true ? '1' : '0',
      ],
      // Not detached: a detached child exits before it can draw the card.
      { stdio: ['ignore', errorLog, errorLog], windowsHide: true },
    )
    child.on('error', (error) => logEvent(`helper spawn error: ${error.message}`))
    child.on('exit', (code) => logEvent(`helper exit code=${code}`))
    child.unref()
    return true
  } catch (error) {
    logEvent(`helper failed: ${error.message}`)
    return false
  }
}

function authorized(req) {
  return req.method === 'POST' && req.headers['x-completion-notify'] === '1'
}

function readJsonBody(req, limit) {
  return new Promise((resolve) => {
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) {
        req.destroy()
        resolve(undefined)
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch (error) {
        resolve(undefined)
      }
    })
    req.on('error', () => resolve(undefined))
  })
}

/** One-time proof on the user's screen that the channel works. */
function announceReadyOnce() {
  try {
    const directory = join(tmpdir(), 'dsh-completion-notify')
    mkdirSync(directory, { recursive: true })
    const flag = join(directory, 'ready.flag')
    if (existsSync(flag)) return
    writeFileSync(flag, new Date().toISOString(), 'utf8')
    showCard({
      meta: 'DeepSeek Harness · 已就绪',
      title: '完成提醒已开启',
      detail: '会话在后台完成时会弹出这样的卡片。',
      sessionId: '',
      baseUrl: '',
      dark: false,
    })
  } catch (error) {
    /* best effort */
  }
}

export function apply(ctx) {
  if (process.platform !== 'win32') return

  ctx.effect(
    () =>
      ctx.on('session/event', (session, event) => {
        if (event?.type !== 'assistant/message') return
        const sessionId = session?.id ?? session?.sessionId
        const snippet = snippetOf(event)
        logEvent(`answer id=${String(sessionId)} len=${snippet.length}`)
        if (typeof sessionId === 'string' && snippet !== '') rememberAnswer(sessionId, snippet)
      }),
    'completion-notify: last answer cache',
  )

  ctx.inject(['webServer'], (scope) => {
    let pendingOpen

    const origin = () => {
      try {
        return scope.webServer.getOrigin()
      } catch (error) {
        return ''
      }
    }

    scope.effect(
      () =>
        scope.webServer.register({
          kind: 'exact',
          path: TOAST_ROUTE,
          handler: async (req, res) => {
            if (!authorized(req)) {
              res.statusCode = 400
              res.end()
              return
            }
            const payload = await readJsonBody(req, 16 * 1024)
            const sessionId = typeof payload?.sessionId === 'string' ? payload.sessionId : ''
            const title = typeof payload?.title === 'string' ? payload.title : ''
            const meta = typeof payload?.meta === 'string' ? payload.meta : 'DeepSeek Harness'
            const fallback = typeof payload?.fallback === 'string' ? payload.fallback : ''
            if (title === '' && fallback === '') {
              res.statusCode = 400
              res.end()
              return
            }
            const snippet = lastAnswers.get(sessionId) ?? ''
            const shown = showCard({
              meta,
              title,
              detail: snippet !== '' ? snippet : fallback,
              sessionId,
              baseUrl: origin(),
              dark: payload?.dark === true,
            })
            logEvent(`card shown=${shown} session=${sessionId} snippet=${snippet.length}`)
            res.statusCode = 204
            res.end()
          },
        }),
      'completion-notify: card route',
    )

    scope.effect(
      () =>
        scope.webServer.register({
          kind: 'exact',
          path: CLICK_ROUTE,
          handler: async (req, res) => {
            if (!authorized(req)) {
              res.statusCode = 400
              res.end()
              return
            }
            const payload = await readJsonBody(req, 4 * 1024)
            if (typeof payload?.sessionId === 'string' && payload.sessionId !== '') {
              pendingOpen = { sessionId: payload.sessionId, at: Date.now() }
              logEvent(`card clicked session=${payload.sessionId}`)
            }
            res.statusCode = 204
            res.end()
          },
        }),
      'completion-notify: click route',
    )

    scope.effect(
      () =>
        scope.webServer.register({
          kind: 'exact',
          path: PENDING_ROUTE,
          handler: (req, res) => {
            if (req.method !== 'GET' || req.headers['x-completion-notify'] !== '1') {
              res.statusCode = 400
              res.end()
              return
            }
            let body = '{}'
            if (pendingOpen !== undefined && Date.now() - pendingOpen.at < 60000) {
              body = JSON.stringify({ sessionId: pendingOpen.sessionId })
              pendingOpen = undefined
            }
            res.setHeader('content-type', 'application/json')
            res.setHeader('cache-control', 'no-store')
            res.statusCode = 200
            res.end(body)
          },
        }),
      'completion-notify: pending route',
    )

    scope.effect(
      () =>
        scope.webServer.register({
          kind: 'exact',
          path: PING_ROUTE,
          handler: async (req, res) => {
            if (!authorized(req)) {
              res.statusCode = 400
              res.end()
              return
            }
            const payload = await readJsonBody(req, 4 * 1024)
            logEvent(`ping from the page dark=${payload?.dark === true}`)
            res.statusCode = 204
            res.end()
          },
        }),
      'completion-notify: ping route',
    )

    scope.effect(() => () => {
      scriptPath = undefined
    }, 'completion-notify: helper cache')
  })

  announceReadyOnce()
}
