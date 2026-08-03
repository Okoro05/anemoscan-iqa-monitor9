import { createFileRoute } from '@tanstack/react-router'
import {
  Aperture,
  Camera,
  CheckCircle2,
  Download,
  FlipHorizontal2,
  Home,
  ImagePlus,
  Loader2,
  MoreVertical,
  PencilLine,
  Save,
  ScanLine,
  ShieldAlert,
  Tag,
  Trash2,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

export const Route = createFileRoute('/')({
  component: MonitorScreen,
})

const qualityThreshold = 65

type FacingMode = 'user' | 'environment'
type Metrics = {
  brightness: number
  sharpness: number
  contrast: number
  overall: number
}
type SavedCapture = Metrics & {
  id: number
  blobKey: string
  name: string | null
  status: string
  cameraLabel: string
  threshold: number
  imageUrl: string
  createdAt: string
}

type PendingCapture = {
  dataUrl: string
  metrics: Metrics
  cameraLabel: string
  status: string
  capturedAt: Date
}

function defaultCaptureName(date: Date) {
  const pad = (value: number) => value.toString().padStart(2, '0')
  return `capture-${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(
    date.getHours(),
  )}${pad(date.getMinutes())}${pad(date.getSeconds())}`
}

const initialMetrics: Metrics = {
  brightness: 58,
  sharpness: 72,
  contrast: 54,
  overall: 61,
}

function clamp(value: number, min = 0, max = 100) {
  return Math.min(max, Math.max(min, value))
}

function round(value: number) {
  return Math.round(clamp(value))
}

function calculateMetricsFromImageData(imageData: ImageData): Metrics {
  const { data, width, height } = imageData
  const luminance = new Float32Array(width * height)
  let sum = 0

  for (let i = 0, pixel = 0; i < data.length; i += 4, pixel += 1) {
    const gray = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114
    luminance[pixel] = gray
    sum += gray
  }

  const mean = sum / luminance.length
  let variance = 0
  let laplacianVariance = 0
  let laplacianCount = 0

  for (let i = 0; i < luminance.length; i += 1) {
    const diff = luminance[i] - mean
    variance += diff * diff
  }

  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const idx = y * width + x
      const laplacian =
        -4 * luminance[idx] +
        luminance[idx - 1] +
        luminance[idx + 1] +
        luminance[idx - width] +
        luminance[idx + width]
      laplacianVariance += laplacian * laplacian
      laplacianCount += 1
    }
  }

  const brightness = clamp((mean / 255) * 100)
  const contrast = clamp((Math.sqrt(variance / luminance.length) / 82) * 100)
  const sharpness = clamp(
    (Math.sqrt(laplacianVariance / Math.max(laplacianCount, 1)) / 22) * 100,
  )
  const overall = clamp(brightness * 0.3 + sharpness * 0.4 + contrast * 0.3)

  return { brightness, sharpness, contrast, overall }
}

function MonitorScreen() {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [facingMode, setFacingMode] = useState<FacingMode>('environment')
  const [metrics, setMetrics] = useState<Metrics>(initialMetrics)
  const [cameraReady, setCameraReady] = useState(false)
  const [cameraError, setCameraError] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveMessage, setSaveMessage] = useState('')
  const [captures, setCaptures] = useState<SavedCapture[]>([])
  const [pendingCapture, setPendingCapture] = useState<PendingCapture | null>(null)
  const [captureName, setCaptureName] = useState('')
  const [nameError, setNameError] = useState('')
  const [openMenuId, setOpenMenuId] = useState<number | null>(null)
  const [renameTarget, setRenameTarget] = useState<SavedCapture | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [renameError, setRenameError] = useState('')
  const [renaming, setRenaming] = useState(false)
  const [deletingId, setDeletingId] = useState<number | null>(null)

  const accepted = metrics.overall >= qualityThreshold
  const status = accepted ? 'READY' : 'LOW QUALITY'
  const cameraLabel = facingMode === 'user' ? 'FRONT' : 'BACK'

  useEffect(() => {
    let stream: MediaStream | null = null
    let cancelled = false

    async function startCamera() {
      setCameraReady(false)
      setCameraError('')

      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode,
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        })

        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop())
          return
        }

        if (videoRef.current) {
          videoRef.current.srcObject = stream
          await videoRef.current.play()
          setCameraReady(true)
        }
      } catch {
        setCameraError('Camera access is unavailable. Enable camera permission.')
        setCameraReady(false)
      }
    }

    startCamera()

    return () => {
      cancelled = true
      stream?.getTracks().forEach((track) => track.stop())
    }
  }, [facingMode])

  useEffect(() => {
    async function loadCaptures() {
      try {
        const response = await fetch('/api/captures')
        if (response.ok) {
          const data = (await response.json()) as { captures: SavedCapture[] }
          setCaptures(data.captures)
        }
      } catch {
        setCaptures([])
      }
    }

    loadCaptures()
  }, [])

  const analyzeFrame = useCallback(() => {
    const video = videoRef.current
    const canvas = canvasRef.current

    if (!video || !canvas || video.readyState < 2) {
      return
    }

    const width = 160
    const height = Math.max(90, Math.round((video.videoHeight / video.videoWidth) * width))
    const context = canvas.getContext('2d', { willReadFrequently: true })

    if (!context) {
      return
    }

    canvas.width = width
    canvas.height = height
    context.drawImage(video, 0, 0, width, height)
    setMetrics(calculateMetricsFromImageData(context.getImageData(0, 0, width, height)))
  }, [])

  useEffect(() => {
    const timer = window.setInterval(analyzeFrame, 500)
    return () => window.clearInterval(timer)
  }, [analyzeFrame])

  const captureSnapshot = useCallback(() => {
    if (!accepted) {
      setSaveMessage(`Score must reach ${qualityThreshold} before you can capture.`)
      return
    }

    const video = videoRef.current

    if (!video || video.readyState < 2) {
      setSaveMessage('Camera frame is not ready yet.')
      return
    }

    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth || 1280
    canvas.height = video.videoHeight || 720
    const context = canvas.getContext('2d')

    if (!context) {
      setSaveMessage('Unable to capture this frame.')
      return
    }

    context.drawImage(video, 0, 0, canvas.width, canvas.height)
    const dataUrl = canvas.toDataURL('image/jpeg', 0.9)
    const capturedAt = new Date()

    // Freeze the metrics/labels at the moment of capture so the save dialog
    // reflects exactly what was true when the shutter was pressed, even if
    // the live feed keeps analyzing frames while the user types a name.
    setPendingCapture({ dataUrl, metrics, cameraLabel, status, capturedAt })
    setCaptureName(defaultCaptureName(capturedAt))
    setNameError('')
    setSaveMessage('')
  }, [accepted, cameraLabel, metrics, status])

  const cancelPendingCapture = useCallback(() => {
    setPendingCapture(null)
    setCaptureName('')
    setNameError('')
  }, [])

  const confirmSaveCapture = useCallback(async () => {
    if (!pendingCapture) {
      return
    }

    const trimmedName = captureName.trim()

    if (!trimmedName) {
      setNameError('Enter a name for this snapshot before saving.')
      return
    }

    setSaving(true)
    setSaveMessage('Saving capture...')

    try {
      const response = await fetch('/api/captures', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageData: pendingCapture.dataUrl,
          name: trimmedName,
          metrics: pendingCapture.metrics,
          threshold: qualityThreshold,
          cameraLabel: pendingCapture.cameraLabel,
          status: pendingCapture.status,
        }),
      })

      if (!response.ok) {
        throw new Error('Save failed')
      }

      const data = (await response.json()) as { capture: SavedCapture }
      setCaptures((current) => [data.capture, ...current].slice(0, 4))
      setSaveMessage(`"${data.capture.name ?? trimmedName}" saved to image store.`)
      setPendingCapture(null)
      setCaptureName('')
      setNameError('')
    } catch {
      setNameError('Capture could not be saved. Try again.')
    } finally {
      setSaving(false)
    }
  }, [captureName, pendingCapture])

  useEffect(() => {
    if (openMenuId === null) {
      return
    }

    function handleClickOutside(event: MouseEvent) {
      const target = event.target as HTMLElement
      if (!target.closest('.thumb-menu-wrap')) {
        setOpenMenuId(null)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [openMenuId])

  const startRename = useCallback((capture: SavedCapture) => {
    setOpenMenuId(null)
    setRenameTarget(capture)
    setRenameValue(capture.name ?? '')
    setRenameError('')
  }, [])

  const cancelRename = useCallback(() => {
    if (renaming) {
      return
    }
    setRenameTarget(null)
    setRenameValue('')
    setRenameError('')
  }, [renaming])

  const confirmRename = useCallback(async () => {
    if (!renameTarget) {
      return
    }

    const trimmed = renameValue.trim()

    if (!trimmed) {
      setRenameError('Enter a name for this snapshot.')
      return
    }

    setRenaming(true)

    try {
      const response = await fetch(`/api/captures/item/${renameTarget.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed }),
      })

      if (!response.ok) {
        throw new Error('Rename failed')
      }

      const data = (await response.json()) as { capture: SavedCapture }
      setCaptures((current) =>
        current.map((item) => (item.id === data.capture.id ? data.capture : item)),
      )
      setRenameTarget(null)
      setRenameValue('')
      setRenameError('')
    } catch {
      setRenameError('Could not rename this capture. Try again.')
    } finally {
      setRenaming(false)
    }
  }, [renameTarget, renameValue])

  const handleDownload = useCallback((capture: SavedCapture) => {
    setOpenMenuId(null)
    const extension = capture.blobKey.split('.').pop() || 'jpg'
    const link = document.createElement('a')
    link.href = capture.imageUrl
    link.download = `${capture.name || `capture-${capture.id}`}.${extension}`
    document.body.appendChild(link)
    link.click()
    link.remove()
  }, [])

  const handleDelete = useCallback(async (capture: SavedCapture) => {
    setOpenMenuId(null)

    const confirmed = window.confirm(
      `Delete "${capture.name || 'this snapshot'}"? This can't be undone.`,
    )
    if (!confirmed) {
      return
    }

    setDeletingId(capture.id)

    try {
      const response = await fetch(`/api/captures/item/${capture.id}`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        throw new Error('Delete failed')
      }

      setCaptures((current) => current.filter((item) => item.id !== capture.id))
    } catch {
      setSaveMessage('Could not delete that capture. Try again.')
    } finally {
      setDeletingId(null)
    }
  }, [])

  const glow = useMemo(() => Math.max(0.25, metrics.overall / 100), [metrics.overall])

  return (
    <main className="min-h-screen overflow-hidden bg-[#050A14] text-cyan-50">
      <div className="fixed inset-0 pointer-events-none bg-[radial-gradient(circle_at_18%_10%,rgba(0,229,212,0.18),transparent_30%),radial-gradient(circle_at_86%_26%,rgba(60,255,143,0.12),transparent_26%),linear-gradient(135deg,rgba(5,10,20,1),rgba(5,10,20,0.86))]" />
      <div className="fixed inset-0 pointer-events-none opacity-[0.13] scan-field" />

      <section className="relative mx-auto flex min-h-screen w-full max-w-7xl flex-col px-4 py-5 sm:px-6 lg:px-8">
        <header className="glass-panel header-grid mb-6 flex items-center justify-between gap-4 px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="icon-cell">
              <Home size={20} />
            </div>
            <div>
              <p className="micro-label">AI CONJUNCTIVA IMAGE QUALITY SYSTEM</p>
              <h1 className="title-text">ANEMOSCAN IQA MONITOR</h1>
            </div>
          </div>
          <StatusIndicator label="READY TO CAPTURE" />
        </header>

        <div className="mb-4 flex items-end justify-between gap-4">
          <div>
            <p className="micro-label">SECTION</p>
            <h2 className="section-title">LIVE QUALITY MONITOR</h2>
          </div>
          <ThresholdIndicator />
        </div>

        <div className="grid flex-1 grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1.32fr)_minmax(360px,0.68fr)]">
          <section className="glass-panel camera-shell p-3 sm:p-4">
            <div
              className="camera-frame"
              style={{
                boxShadow: `0 0 ${24 + glow * 36}px rgba(0, 229, 212, ${0.18 + glow * 0.2})`,
              }}
            >
              <video
                ref={videoRef}
                className="camera-video"
                playsInline
                muted
                autoPlay
              />
              {!cameraReady && (
                <div className="camera-fallback">
                  <Camera size={42} />
                  <span>{cameraError || 'Initializing camera feed'}</span>
                </div>
              )}
              <div className="camera-grid" />
              <div className="corner corner-tl" />
              <div className="corner corner-tr" />
              <div className="corner corner-bl" />
              <div className="corner corner-br" />
              <div className="live-badge">LIVE</div>
              <ScoreDisplay value={metrics.overall} />
            </div>

            <div className="mt-5 flex items-center justify-center gap-5">
              <button
                className="round-control"
                type="button"
                aria-label="Switch camera"
                onClick={() =>
                  setFacingMode((current) =>
                    current === 'environment' ? 'user' : 'environment',
                  )
                }
              >
                <FlipHorizontal2 size={22} />
              </button>
              <button
                className="shutter"
                type="button"
                aria-label={accepted ? 'Capture image' : 'Capture locked: quality below threshold'}
                disabled={saving || !!pendingCapture || !accepted}
                onClick={captureSnapshot}
              >
                <span />
              </button>
              <div className="camera-label">
                <span>{cameraLabel}</span>
                <small>CAMERA</small>
              </div>
            </div>

            <div className="mt-4 flex min-h-6 items-center justify-center gap-2 text-xs uppercase tracking-[0.24em] text-cyan-100/70">
              {accepted ? <Save size={14} /> : <ShieldAlert size={14} className="text-amber-300" />}
              <span>
                {saveMessage ||
                  (accepted
                    ? 'Snap a frame, then name it to save'
                    : `Score must reach ${qualityThreshold} to unlock capture`)}
              </span>
            </div>
          </section>

          <aside className="glass-panel analysis-panel p-4 sm:p-5">
            <div className="mb-5 flex items-center justify-between gap-4">
              <div>
                <p className="micro-label">ANALYSIS</p>
                <h2 className="panel-title">Image Quality</h2>
              </div>
              <div className={`status-chip ${accepted ? 'ready' : 'warning'}`}>
                {accepted ? <CheckCircle2 size={16} /> : <ShieldAlert size={16} />}
                {status}
              </div>
            </div>

            <div className="space-y-5">
              <MetricBar label="BRIGHTNESS" value={metrics.brightness} />
              <MetricBar label="SHARPNESS" value={metrics.sharpness} />
              <MetricBar label="CONTRAST" value={metrics.contrast} />
            </div>

            <div
              className="overall-orb"
              style={{
                boxShadow: `0 0 ${20 + glow * 54}px rgba(60, 255, 143, ${0.12 + glow * 0.32})`,
              }}
            >
              <div>
                <span>OVERALL</span>
                <strong>{round(metrics.overall)}</strong>
              </div>
              <ScanLine size={36} />
            </div>

            <div className="capture-list">
              <div className="mb-3 flex items-center justify-between">
                <span className="micro-label">SAVED SNAPSHOTS</span>
                <ImagePlus size={17} className="text-cyan-200/70" />
              </div>
              {captures.length === 0 ? (
                <div className="empty-capture">
                  <Aperture size={22} />
                  <span>No saved captures yet</span>
                </div>
              ) : (
                <div className="capture-grid">
                  {captures.map((capture) => (
                    <div className="capture-thumb" key={capture.id}>
                      <a
                        className="capture-thumb-link"
                        href={capture.imageUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <img src={capture.imageUrl} alt={capture.name || 'Saved capture'} />
                        <span
                          className={`status-chip thumb-chip ${
                            capture.status === 'READY' ? 'ready' : 'warning'
                          }`}
                        >
                          {Math.round(capture.overall)}
                        </span>
                      </a>

                      <div className="thumb-footer">
                        <span className="thumb-name">
                          {capture.name || new Date(capture.createdAt).toLocaleTimeString()}
                        </span>

                        <div className="thumb-menu-wrap">
                          <button
                            type="button"
                            className="thumb-menu-trigger"
                            aria-label="Snapshot options"
                            disabled={deletingId === capture.id}
                            onClick={() =>
                              setOpenMenuId((current) => (current === capture.id ? null : capture.id))
                            }
                          >
                            {deletingId === capture.id ? (
                              <Loader2 size={16} className="animate-spin" />
                            ) : (
                              <MoreVertical size={16} />
                            )}
                          </button>

                          {openMenuId === capture.id && (
                            <div className="thumb-menu">
                              <button type="button" onClick={() => startRename(capture)}>
                                <PencilLine size={14} />
                                Rename
                              </button>
                              <button type="button" onClick={() => handleDownload(capture)}>
                                <Download size={14} />
                                Download
                              </button>
                              <button
                                type="button"
                                className="thumb-menu-danger"
                                onClick={() => handleDelete(capture)}
                              >
                                <Trash2 size={14} />
                                Delete
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </aside>
        </div>
      </section>
      <canvas ref={canvasRef} className="hidden" />
      {pendingCapture && (
        <NameCaptureDialog
          pendingCapture={pendingCapture}
          name={captureName}
          error={nameError}
          saving={saving}
          onNameChange={(value) => {
            setCaptureName(value)
            if (nameError) {
              setNameError('')
            }
          }}
          onCancel={cancelPendingCapture}
          onConfirm={confirmSaveCapture}
        />
      )}
      {renameTarget && (
        <RenameDialog
          capture={renameTarget}
          name={renameValue}
          error={renameError}
          saving={renaming}
          onNameChange={(value) => {
            setRenameValue(value)
            if (renameError) {
              setRenameError('')
            }
          }}
          onCancel={cancelRename}
          onConfirm={confirmRename}
        />
      )}
    </main>
  )
}

function NameCaptureDialog({
  pendingCapture,
  name,
  error,
  saving,
  onNameChange,
  onCancel,
  onConfirm,
}: {
  pendingCapture: PendingCapture
  name: string
  error: string
  saving: boolean
  onNameChange: (value: string) => void
  onCancel: () => void
  onConfirm: () => void
}) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const accepted = pendingCapture.status === 'READY'

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && !saving) {
        onCancel()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onCancel, saving])

  return (
    <div
      className="dialog-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Name this snapshot"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !saving) {
          onCancel()
        }
      }}
    >
      <div className="glass-panel dialog-card p-4 sm:p-6">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Tag size={18} className="text-cyan-200/80" />
            <h3 className="dialog-title">Name this snapshot</h3>
          </div>
          <button
            type="button"
            className="dialog-close"
            aria-label="Discard capture"
            onClick={onCancel}
            disabled={saving}
          >
            <X size={18} />
          </button>
        </div>

        <div className="dialog-preview">
          <img src={pendingCapture.dataUrl} alt="Captured frame preview" />
          <div className={`status-chip dialog-preview-chip ${accepted ? 'ready' : 'warning'}`}>
            {accepted ? <CheckCircle2 size={14} /> : <ShieldAlert size={14} />}
            {pendingCapture.status} · {round(pendingCapture.metrics.overall)}
          </div>
        </div>

        <label className="dialog-label" htmlFor="capture-name-input">
          FILE NAME
        </label>
        <input
          id="capture-name-input"
          ref={inputRef}
          className="dialog-input"
          type="text"
          value={name}
          maxLength={80}
          placeholder="e.g. patient-042-slide-1"
          disabled={saving}
          onChange={(event) => onNameChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              onConfirm()
            }
          }}
        />
        {error && <p className="dialog-error">{error}</p>}

        <div className="mt-5 flex items-center justify-end gap-3">
          <button
            type="button"
            className="dialog-btn dialog-btn-ghost"
            onClick={onCancel}
            disabled={saving}
          >
            Discard
          </button>
          <button
            type="button"
            className="dialog-btn dialog-btn-primary"
            onClick={onConfirm}
            disabled={saving}
          >
            <Save size={16} />
            {saving ? 'Saving...' : 'Save capture'}
          </button>
        </div>
      </div>
    </div>
  )
}

function RenameDialog({
  capture,
  name,
  error,
  saving,
  onNameChange,
  onCancel,
  onConfirm,
}: {
  capture: SavedCapture
  name: string
  error: string
  saving: boolean
  onNameChange: (value: string) => void
  onCancel: () => void
  onConfirm: () => void
}) {
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && !saving) {
        onCancel()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onCancel, saving])

  return (
    <div
      className="dialog-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Rename snapshot"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !saving) {
          onCancel()
        }
      }}
    >
      <div className="glass-panel dialog-card p-4 sm:p-6">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <PencilLine size={18} className="text-cyan-200/80" />
            <h3 className="dialog-title">Rename snapshot</h3>
          </div>
          <button
            type="button"
            className="dialog-close"
            aria-label="Cancel rename"
            onClick={onCancel}
            disabled={saving}
          >
            <X size={18} />
          </button>
        </div>

        <div className="dialog-preview">
          <img src={capture.imageUrl} alt={capture.name || 'Saved capture'} />
        </div>

        <label className="dialog-label" htmlFor="rename-input">
          FILE NAME
        </label>
        <input
          id="rename-input"
          ref={inputRef}
          className="dialog-input"
          type="text"
          value={name}
          maxLength={80}
          disabled={saving}
          onChange={(event) => onNameChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              onConfirm()
            }
          }}
        />
        {error && <p className="dialog-error">{error}</p>}

        <div className="mt-5 flex items-center justify-end gap-3">
          <button
            type="button"
            className="dialog-btn dialog-btn-ghost"
            onClick={onCancel}
            disabled={saving}
          >
            Cancel
          </button>
          <button
            type="button"
            className="dialog-btn dialog-btn-primary"
            onClick={onConfirm}
            disabled={saving}
          >
            <Save size={16} />
            {saving ? 'Saving...' : 'Save name'}
          </button>
        </div>
      </div>
    </div>
  )
}

function StatusIndicator({ label }: { label: string }) {
  return (
    <div className="system-status">
      <span />
      {label}
    </div>
  )
}

function ThresholdIndicator() {
  return (
    <div className="threshold-card">
      <span>Min required: {qualityThreshold} / 100</span>
      <small>Capture locked below this score</small>
    </div>
  )
}

function MetricBar({ label, value }: { label: string; value: number }) {
  return (
    <div className="metric">
      <div className="mb-2 flex items-center justify-between">
        <span>{label}</span>
        <strong>{round(value)}</strong>
      </div>
      <div className="metric-track">
        <div className="metric-fill" style={{ transform: `scaleX(${clamp(value) / 100})` }} />
      </div>
    </div>
  )
}

function ScoreDisplay({ value }: { value: number }) {
  return (
    <div className="score-display">
      <strong>{round(value)}</strong>
      <span>SCORE</span>
    </div>
  )
}
