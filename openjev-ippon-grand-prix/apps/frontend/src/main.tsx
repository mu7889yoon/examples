import { StrictMode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'

type Screen = 'welcome' | 'booting' | 'arena' | 'finished'

type Session = {
  sessionId: string
  status?: string
  judgeCount?: number
  requiredLaughCount?: number
  ipponThresholdRatio?: number
  startedAt?: string
  expiresAt?: string
}

type JudgeResult = {
  id: string
  name?: string
  probability: number
  laughed: boolean
  completedCount?: number
  laughCount?: number
}

type StreamEvent =
  | { type: 'start'; data: Partial<Session> }
  | { type: 'judge'; data: JudgeResult }
  | { type: 'ippon'; data: { laughCount: number; requiredLaughCount: number; judgeCount: number } }
  | { type: 'complete'; data: { laughCount: number; judgeCount: number; score?: number; ippon?: boolean } }

declare global {
  interface Window {
    __OPENJEV_CONFIG__?: { apiBaseUrl?: string }
  }
}

// Terraform writes this value into openjev-runtime-config.js during apply. The
// Vite value remains useful for local development and explicit preview builds.
const API_BASE = (window.__OPENJEV_CONFIG__?.apiBaseUrl ?? import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '')

function apiUrl(path: string) {
  return `${API_BASE}${path}`
}

async function readJson<T>(response: Response): Promise<T> {
  const body = await response.text()
  let parsed: unknown
  try {
    parsed = body ? JSON.parse(body) : {}
  } catch {
    parsed = { message: body }
  }
  if (!response.ok) {
    const message = typeof parsed === 'object' && parsed && 'message' in parsed
      ? String(parsed.message)
      : `HTTP ${response.status}`
    throw new Error(message)
  }
  return parsed as T
}

function formatTime(totalSeconds: number) {
  const seconds = Math.max(0, Math.floor(totalSeconds))
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const remaining = seconds % 60
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remaining).padStart(2, '0')}`
    : `${String(minutes).padStart(2, '0')}:${String(remaining).padStart(2, '0')}`
}

function normaliseSession(raw: Record<string, unknown>): Session {
  return {
    sessionId: String(raw.sessionId ?? raw.id ?? ''),
    status: raw.status ? String(raw.status) : raw.state ? String(raw.state) : undefined,
    judgeCount: typeof raw.judgeCount === 'number' ? raw.judgeCount : undefined,
    requiredLaughCount: typeof raw.requiredLaughCount === 'number' ? raw.requiredLaughCount : undefined,
    ipponThresholdRatio: typeof raw.ipponThresholdRatio === 'number' ? raw.ipponThresholdRatio : undefined,
    startedAt: raw.startedAt ? String(raw.startedAt) : undefined,
    expiresAt: raw.expiresAt ? String(raw.expiresAt) : undefined,
  }
}

function parseSseBlock(block: string): { event: string; data: unknown } | null {
  const event = block.match(/^event:\s*(.+)$/m)?.[1]?.trim() ?? 'message'
  const data = block.split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trimStart())
    .join('\n')
  if (!data) return null
  try {
    return { event, data: JSON.parse(data) }
  } catch {
    return { event, data }
  }
}

function App() {
  const [screen, setScreen] = useState<Screen>('welcome')
  const [session, setSession] = useState<Session | null>(null)
  const [topic, setTopic] = useState('')
  const [answer, setAnswer] = useState('')
  const [judges, setJudges] = useState<JudgeResult[]>([])
  const [laughCount, setLaughCount] = useState(0)
  const [laughPulse, setLaughPulse] = useState(0)
  const [ippon, setIppon] = useState(false)
  const [score, setScore] = useState<number | null>(null)
  const [isJudging, setIsJudging] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const abortRef = useRef<AbortController | null>(null)
  const pollRef = useRef<number | undefined>(undefined)
  const ipponEventRef = useRef(false)
  const laughedJudgeIdsRef = useRef(new Set<string>())

  const clearPolling = useCallback(() => {
    if (pollRef.current !== undefined) window.clearTimeout(pollRef.current)
    pollRef.current = undefined
  }, [])

  const updateSession = useCallback((raw: Record<string, unknown>) => {
    const next = normaliseSession(raw)
    setSession((previous) => {
      // GET /sessions/{id} may omit the id; do not overwrite the known id with an empty value.
      const merged = { ...previous, ...next }
      if (!next.sessionId && previous?.sessionId) merged.sessionId = previous.sessionId
      return merged
    })
    return next
  }, [])

  const pollStatus = useCallback(async (sessionId: string) => {
    try {
      const response = await fetch(apiUrl(`/sessions/${encodeURIComponent(sessionId)}`))
      const next = await readJson<Record<string, unknown>>(response)
      const status = updateSession(next)
      if (['RUNNING', 'READY', 'ACTIVE'].includes((status.status ?? '').toUpperCase())) {
        setScreen('arena')
        return
      }
      if (['ENDED', 'TERMINATED', 'EXPIRED', 'FAILED'].includes((status.status ?? '').toUpperCase())) {
        setScreen('finished')
        return
      }
      pollRef.current = window.setTimeout(() => void pollStatus(sessionId), 1500)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '会場状態を取得できませんでした')
      pollRef.current = window.setTimeout(() => void pollStatus(sessionId), 3000)
    }
  }, [updateSession])

  useEffect(() => () => {
    clearPolling()
    abortRef.current?.abort()
  }, [clearPolling])

  useEffect(() => {
    if (screen !== 'arena' || !session?.expiresAt) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [screen, session?.expiresAt])

  const remainingSeconds = useMemo(() => {
    if (!session?.expiresAt) return null
    const expiry = Date.parse(session.expiresAt)
    if (Number.isNaN(expiry)) return null
    return Math.max(0, Math.ceil((expiry - now) / 1000))
  }, [now, session?.expiresAt])

  useEffect(() => {
    if (remainingSeconds === 0 && screen === 'arena') setScreen('finished')
  }, [remainingSeconds, screen])

  const startSession = async () => {
    setError(null)
    setScreen('booting')
    try {
      const response = await fetch(apiUrl('/sessions'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      const created = updateSession(await readJson<Record<string, unknown>>(response))
      if (!created.sessionId) throw new Error('sessionId がレスポンスにありません')
      setJudges([])
      setLaughCount(0)
      setLaughPulse(0)
      laughedJudgeIdsRef.current.clear()
      setIppon(false)
      ipponEventRef.current = false
      setScore(null)
      await pollStatus(created.sessionId)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '会場を開始できませんでした')
      setScreen('welcome')
    }
  }

  const finishSession = async () => {
    if (!session) return
    clearPolling()
    abortRef.current?.abort()
    try {
      await fetch(apiUrl(`/sessions/${encodeURIComponent(session.sessionId)}`), { method: 'DELETE' })
    } catch {
      // A session may already have expired; the UI still transitions to the end screen.
    }
    setScreen('finished')
  }

  const handleStreamEvent = (event: StreamEvent) => {
    if (event.type === 'start') {
      setSession((previous) => previous ? { ...previous, ...event.data } : previous)
      return
    }
    if (event.type === 'judge') {
      setJudges((previous) => [...previous.filter((item) => item.id !== event.data.id), event.data])
      if (typeof event.data.laughCount === 'number') setLaughCount(event.data.laughCount)
      if (event.data.laughed && !laughedJudgeIdsRef.current.has(event.data.id)) {
        laughedJudgeIdsRef.current.add(event.data.id)
        setLaughPulse((previous) => previous + 1)
      }
      return
    }
    if (event.type === 'ippon') {
      if (ipponEventRef.current) return
      ipponEventRef.current = true
      setIppon(true)
      return
    }
    setScore(typeof event.data.score === 'number' ? event.data.score : null)
    if (event.data.ippon && !ipponEventRef.current) {
      ipponEventRef.current = true
      setIppon(true)
    }
  }

  const judge = async (submitEvent: React.FormEvent) => {
    submitEvent.preventDefault()
    if (!session || !topic.trim() || !answer.trim() || isJudging) return
    setError(null)
    setJudges([])
    setLaughCount(0)
    setLaughPulse(0)
    laughedJudgeIdsRef.current.clear()
    setIppon(false)
    ipponEventRef.current = false
    setScore(null)
    setIsJudging(true)
    const controller = new AbortController()
    abortRef.current = controller
    try {
      const response = await fetch(apiUrl(`/sessions/${encodeURIComponent(session.sessionId)}/judge`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
        body: JSON.stringify({ topic: topic.trim(), answer: answer.trim() }),
        signal: controller.signal,
      })
      if (!response.ok) {
        const body = await response.text()
        let message = `HTTP ${response.status}`
        try {
          const payload = JSON.parse(body) as { message?: string }
          if (payload.message) message = payload.message
        } catch {
          if (body) message = body
        }
        throw new Error(message)
      }
      if (!response.body) throw new Error('SSEレスポンスを受信できませんでした')
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      while (true) {
        const chunk = await reader.read()
        buffer += decoder.decode(chunk.value ?? new Uint8Array(), { stream: !chunk.done })
        const blocks = buffer.split(/\r?\n\r?\n/)
        buffer = blocks.pop() ?? ''
        for (const block of blocks) {
          const parsed = parseSseBlock(block)
          if (parsed) handleStreamEvent({ type: parsed.event as StreamEvent['type'], data: parsed.data } as StreamEvent)
        }
        if (chunk.done) break
      }
      const finalBlock = parseSseBlock(buffer)
      if (finalBlock) handleStreamEvent({ type: finalBlock.event as StreamEvent['type'], data: finalBlock.data } as StreamEvent)
    } catch (cause) {
      if (!(cause instanceof DOMException && cause.name === 'AbortError')) {
        setError(cause instanceof Error ? cause.message : '判定に失敗しました')
      }
    } finally {
      setIsJudging(false)
      abortRef.current = null
    }
  }

  const reset = () => {
    clearPolling()
    abortRef.current?.abort()
    setSession(null)
    setTopic('')
    setAnswer('')
    setJudges([])
    setLaughCount(0)
    setLaughPulse(0)
    laughedJudgeIdsRef.current.clear()
    setIppon(false)
    ipponEventRef.current = false
    setScore(null)
    setError(null)
    setScreen('welcome')
  }

  const laughTarget = session?.requiredLaughCount ?? session?.judgeCount ?? 1
  const laughProgress = Math.min(1, laughCount / laughTarget)
  const laughDepth = `${Math.round(laughProgress * 50)}%`

  return (
    <main className="page-shell">
      <header className="topbar">
        <div className="brand-mark"><span>笑</span> OPENJEV IPPON</div>
        {session && screen === 'arena' && <div className="session-pill">SESSION {session.sessionId.slice(0, 8)}</div>}
      </header>
      {error && <div className="error-banner" role="alert">{error}</div>}

      {screen === 'welcome' && (
        <section className="hero-card centered-card">
          <div className="eyebrow">AI 大喜利審査システム</div>
          <h1>笑いを、<em>判定</em>する。</h1>
          <p className="lead">複数のAI審査員が、あなたの回答をリアルタイムで審査します。</p>
          <div className="stat-row"><div><strong>{session?.judgeCount ?? '—'}</strong><span>AI審査員</span></div><div><strong>60</strong><span>分間の会場</span></div><div><strong>LIVE</strong><span>リアルタイム判定</span></div></div>
          <button className="primary-button launch-button" onClick={() => void startSession()}>大喜利会場を開始 <span>→</span></button>
          <p className="fine-print">会場を開始すると、AI審査エンジンを起動します</p>
        </section>
      )}

      {screen === 'booting' && (
        <section className="status-card centered-card"><div className="spinner" /><div className="eyebrow">INITIALIZING SESSION</div><h2>大喜利会場を起動しています…</h2><p>AI審査員を準備しています。しばらくお待ちください。</p><div className="loading-track"><span /></div>{session?.judgeCount && <small>{session.judgeCount}人の審査員を読み込み中</small>}</section>
      )}

      {screen === 'arena' && session && (
        <section className="arena-layout">
          <div className="arena-heading"><div><div className="eyebrow">LIVE ARENA</div><h1>AI 大喜利大会</h1></div><div className="arena-actions"><div className="countdown"><span>残り時間</span><strong className={remainingSeconds !== null && remainingSeconds < 300 ? 'warning' : ''}>{remainingSeconds === null ? '--:--' : formatTime(remainingSeconds)}</strong></div><button className="ghost-button" onClick={() => void finishSession()}>会場を終了</button></div></div>
          <div className="arena-grid">
            <form className="question-card" onSubmit={judge}><label htmlFor="topic">お題</label><textarea id="topic" value={topic} onChange={(event) => setTopic(event.target.value)} placeholder="例：こんなAWSは嫌だ。どんなAWS？" rows={3} /><label htmlFor="answer">あなたの回答</label><textarea id="answer" value={answer} onChange={(event) => setAnswer(event.target.value)} placeholder="回答を入力してください" rows={5} /><button className="primary-button" disabled={isJudging || !topic.trim() || !answer.trim()}>{isJudging ? '審査中…' : '判定！'} <span>→</span></button></form>
            <aside className="judges-card"><div className="card-title"><div><span className="live-dot" />AI審査員</div><strong>{judges.length}<small> / {session.judgeCount ?? '—'}</small></strong></div><div className="threshold">{session.requiredLaughCount ? `${session.requiredLaughCount}人以上が笑えば IPPON` : '判定結果を待っています'}</div><div className="judge-list">{judges.length === 0 && <div className="empty-state">回答を送信すると<br />審査員の判定が表示されます</div>}{judges.map((result) => <div className={`judge-row ${result.laughed ? 'laughed' : ''}`} key={result.id}><span className="judge-avatar">{result.name?.slice(0, 1) ?? '審'}</span><div className="judge-name"><strong>{result.name ?? result.id}</strong><span>{result.laughed ? '笑った！' : '笑わない'}</span></div><div className="probability">{Math.round(result.probability * 100)}%</div><span className="result-icon">{result.laughed ? '😂' : '—'}</span></div>)}</div></aside>
          </div>
          {laughPulse > 0 && <div className="laugh-bars" key={laughPulse} style={{ '--laugh-depth': laughDepth } as React.CSSProperties} aria-hidden="true"><span className="laugh-bar top" /><span className="laugh-bar right" /><span className="laugh-bar bottom" /><span className="laugh-bar left" /></div>}
          {ippon && <div className="ippon-overlay" role="status"><div className="burst">🎉</div><div className="ippon-label">IPPON!</div><p>おめでとうございます！</p><button className="ghost-button" onClick={() => setIppon(false)}>結果を見る</button></div>}
          {score !== null && <div className="score-note">今回のスコア: <strong>{score.toFixed(2)}</strong></div>}
        </section>
      )}

      {screen === 'finished' && <section className="status-card centered-card finished-card"><div className="finish-icon">✓</div><div className="eyebrow">SESSION ENDED</div><h2>大喜利会場 終了</h2><p>ご参加ありがとうございました。</p>{score !== null && <div className="final-score">最終スコア <strong>{score.toFixed(2)}</strong></div>}<button className="primary-button" onClick={reset}>新しい会場を開始 <span>→</span></button></section>}
      <footer>OPENJEV IPPON GRAND PRIX <span>•</span> AI-powered comedy judging</footer>
    </main>
  )
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)
