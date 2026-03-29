/**
 * Full-viewport canvas overlay for element selection highlights.
 * Draws lerp-animated rectangles for selection, drag, grabbed, and inspect layers.
 * Ported from react-grab's OverlayCanvas — pure Canvas API, no framework.
 */
import { lerp } from './utils/lerp.js'
import {
  SELECTION_LERP_FACTOR, DRAG_LERP_FACTOR,
  LERP_CONVERGENCE_THRESHOLD_PX, OPACITY_CONVERGENCE_THRESHOLD,
  MIN_DEVICE_PIXEL_RATIO, FEEDBACK_DURATION_MS, FADE_OUT_BUFFER_MS,
  OVERLAY_BORDER_COLOR_DEFAULT, OVERLAY_FILL_COLOR_DEFAULT,
  OVERLAY_BORDER_COLOR_DRAG, OVERLAY_FILL_COLOR_DRAG,
  OVERLAY_BORDER_COLOR_INSPECT, OVERLAY_FILL_COLOR_INSPECT,
  Z_INDEX_OVERLAY_CANVAS,
} from './constants.js'

export interface OverlayBounds {
  x: number; y: number; width: number; height: number; borderRadius: string
}

interface AnimatedBounds {
  id: string
  current: { x: number; y: number; width: number; height: number }
  target: { x: number; y: number; width: number; height: number }
  borderRadius: number
  opacity: number
  targetOpacity: number
  createdAt?: number
  initialized: boolean
}

interface LayerStyle {
  borderColor: string; fillColor: string; lerpFactor: number
}

const LAYER_STYLES = {
  selection: { borderColor: OVERLAY_BORDER_COLOR_DEFAULT, fillColor: OVERLAY_FILL_COLOR_DEFAULT, lerpFactor: SELECTION_LERP_FACTOR },
  drag: { borderColor: OVERLAY_BORDER_COLOR_DRAG, fillColor: OVERLAY_FILL_COLOR_DRAG, lerpFactor: DRAG_LERP_FACTOR },
  grabbed: { borderColor: OVERLAY_BORDER_COLOR_DEFAULT, fillColor: OVERLAY_FILL_COLOR_DEFAULT, lerpFactor: SELECTION_LERP_FACTOR },
  inspect: { borderColor: OVERLAY_BORDER_COLOR_INSPECT, fillColor: OVERLAY_FILL_COLOR_INSPECT, lerpFactor: SELECTION_LERP_FACTOR },
} as const

type LayerName = keyof typeof LAYER_STYLES

interface OffscreenLayer {
  canvas: OffscreenCanvas | null
  ctx: OffscreenCanvasRenderingContext2D | null
}

// --- Helpers ---

const parseBorderRadius = (br: string): number => {
  const m = br.match(/^(\d+(?:\.\d+)?)/)
  return m ? parseFloat(m[1]) : 0
}

const createAnimated = (id: string, bounds: OverlayBounds, opts?: { createdAt?: number; opacity?: number; targetOpacity?: number }): AnimatedBounds => ({
  id,
  current: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
  target: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
  borderRadius: parseBorderRadius(bounds.borderRadius),
  opacity: opts?.opacity ?? 1,
  targetOpacity: opts?.targetOpacity ?? opts?.opacity ?? 1,
  createdAt: opts?.createdAt,
  initialized: true,
})

const updateTarget = (anim: AnimatedBounds, bounds: OverlayBounds, targetOpacity?: number) => {
  anim.target = { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height }
  anim.borderRadius = parseBorderRadius(bounds.borderRadius)
  if (targetOpacity !== undefined) anim.targetOpacity = targetOpacity
}

const interpolate = (anim: AnimatedBounds, factor: number, interpOpacity = false): boolean => {
  const lx = lerp(anim.current.x, anim.target.x, factor)
  const ly = lerp(anim.current.y, anim.target.y, factor)
  const lw = lerp(anim.current.width, anim.target.width, factor)
  const lh = lerp(anim.current.height, anim.target.height, factor)

  const converged =
    Math.abs(lx - anim.target.x) < LERP_CONVERGENCE_THRESHOLD_PX &&
    Math.abs(ly - anim.target.y) < LERP_CONVERGENCE_THRESHOLD_PX &&
    Math.abs(lw - anim.target.width) < LERP_CONVERGENCE_THRESHOLD_PX &&
    Math.abs(lh - anim.target.height) < LERP_CONVERGENCE_THRESHOLD_PX

  anim.current.x = converged ? anim.target.x : lx
  anim.current.y = converged ? anim.target.y : ly
  anim.current.width = converged ? anim.target.width : lw
  anim.current.height = converged ? anim.target.height : lh

  let opacityConverged = true
  if (interpOpacity) {
    const lo = lerp(anim.opacity, anim.targetOpacity, factor)
    opacityConverged = Math.abs(lo - anim.targetOpacity) < OPACITY_CONVERGENCE_THRESHOLD
    anim.opacity = opacityConverged ? anim.targetOpacity : lo
  }

  return !converged || !opacityConverged
}

const drawRoundedRect = (
  ctx: OffscreenCanvasRenderingContext2D,
  x: number, y: number, w: number, h: number,
  radius: number, fill: string, stroke: string, opacity = 1,
) => {
  if (w <= 0 || h <= 0) return
  const r = Math.min(radius, w / 2, h / 2)
  ctx.globalAlpha = opacity
  ctx.beginPath()
  if (r > 0) ctx.roundRect(x, y, w, h, r)
  else ctx.rect(x, y, w, h)
  ctx.fillStyle = fill
  ctx.fill()
  ctx.strokeStyle = stroke
  ctx.lineWidth = 1
  ctx.stroke()
  ctx.globalAlpha = 1
}

// --- OverlayCanvas class ---

export class OverlayCanvas {
  private canvas: HTMLCanvasElement
  private mainCtx: CanvasRenderingContext2D | null = null
  private w = 0
  private h = 0
  private dpr = 1
  private frameId: number | null = null
  private layers: Record<LayerName, OffscreenLayer> = {
    selection: { canvas: null, ctx: null },
    drag: { canvas: null, ctx: null },
    grabbed: { canvas: null, ctx: null },
    inspect: { canvas: null, ctx: null },
  }

  // Animation state
  selectionAnims: AnimatedBounds[] = []
  dragAnim: AnimatedBounds | null = null
  grabbedAnims: AnimatedBounds[] = []
  inspectAnims: AnimatedBounds[] = []

  // Visibility flags
  selectionVisible = false
  selectionFading = false
  dragVisible = false

  constructor(container: HTMLElement) {
    this.canvas = document.createElement('canvas')
    this.canvas.setAttribute('data-element-grab-canvas', '')
    this.canvas.style.position = 'fixed'
    this.canvas.style.top = '0'
    this.canvas.style.left = '0'
    this.canvas.style.pointerEvents = 'none'
    this.canvas.style.zIndex = String(Z_INDEX_OVERLAY_CANVAS)
    container.appendChild(this.canvas)
    this.init()
    window.addEventListener('resize', () => this.init())
  }

  private init() {
    const colorSpace: PredefinedColorSpace =
      (typeof window !== 'undefined' && window.matchMedia?.('(color-gamut: p3)')?.matches)
        ? 'display-p3' : 'srgb'

    this.dpr = Math.max(window.devicePixelRatio || 1, MIN_DEVICE_PIXEL_RATIO)
    this.w = window.innerWidth
    this.h = window.innerHeight
    this.canvas.width = this.w * this.dpr
    this.canvas.height = this.h * this.dpr
    this.canvas.style.width = `${this.w}px`
    this.canvas.style.height = `${this.h}px`
    this.mainCtx = this.canvas.getContext('2d', { colorSpace })
    if (this.mainCtx) this.mainCtx.scale(this.dpr, this.dpr)

    for (const name of Object.keys(this.layers) as LayerName[]) {
      const oc = new OffscreenCanvas(this.w * this.dpr, this.h * this.dpr)
      const ctx = oc.getContext('2d', { colorSpace })
      if (ctx) ctx.scale(this.dpr, this.dpr)
      this.layers[name] = { canvas: oc, ctx }
    }
  }

  // --- Public API ---

  setSelection(bounds: OverlayBounds | null, snap = false) {
    if (!bounds) {
      this.selectionAnims = []
      this.schedule()
      return
    }
    if (this.selectionAnims.length > 0) {
      updateTarget(this.selectionAnims[0], bounds)
      if (snap) this.selectionAnims[0].current = { ...this.selectionAnims[0].target }
    } else {
      this.selectionAnims = [createAnimated('sel-0', bounds)]
    }
    this.schedule()
  }

  setSelectionMultiple(boundsList: OverlayBounds[], snap = false) {
    this.selectionAnims = boundsList.map((b, i) => {
      const id = `sel-${i}`
      const existing = this.selectionAnims.find(a => a.id === id)
      if (existing) {
        updateTarget(existing, b)
        if (snap) existing.current = { ...existing.target }
        return existing
      }
      return createAnimated(id, b)
    })
    this.schedule()
  }

  setDrag(bounds: OverlayBounds | null) {
    if (!bounds) { this.dragAnim = null; this.schedule(); return }
    if (this.dragAnim) updateTarget(this.dragAnim, bounds)
    else this.dragAnim = createAnimated('drag', bounds)
    this.schedule()
  }

  addGrabbed(id: string, bounds: OverlayBounds) {
    if (!this.grabbedAnims.find(a => a.id === id)) {
      this.grabbedAnims.push(createAnimated(id, bounds, { createdAt: Date.now() }))
    }
    this.schedule()
  }

  setInspect(boundsList: OverlayBounds[]) {
    this.inspectAnims = boundsList.map((b, i) => {
      const id = `inspect-${i}`
      const existing = this.inspectAnims.find(a => a.id === id)
      if (existing) { updateTarget(existing, b); return existing }
      return createAnimated(id, b)
    })
    this.schedule()
  }

  clearInspect() { this.inspectAnims = []; this.schedule() }

  destroy() {
    if (this.frameId !== null) cancelAnimationFrame(this.frameId)
    this.canvas.remove()
    window.removeEventListener('resize', () => this.init())
  }

  // --- Animation loop ---

  private schedule() {
    if (this.frameId !== null) return
    this.frameId = requestAnimationFrame(() => this.tick())
  }

  private tick() {
    this.frameId = null
    let animating = false

    // Interpolate selection
    for (const a of this.selectionAnims) {
      if (a.initialized && interpolate(a, LAYER_STYLES.selection.lerpFactor)) animating = true
    }

    // Interpolate drag
    if (this.dragAnim?.initialized) {
      if (interpolate(this.dragAnim, LAYER_STYLES.drag.lerpFactor)) animating = true
    }

    // Interpolate grabbed with fadeout
    const now = Date.now()
    this.grabbedAnims = this.grabbedAnims.filter(a => {
      if (a.initialized) {
        if (interpolate(a, LAYER_STYLES.grabbed.lerpFactor)) animating = true
      }
      if (a.createdAt) {
        const elapsed = now - a.createdAt
        if (elapsed >= FEEDBACK_DURATION_MS + FADE_OUT_BUFFER_MS) return false
        if (elapsed > FEEDBACK_DURATION_MS) {
          a.opacity = 1 - (elapsed - FEEDBACK_DURATION_MS) / FADE_OUT_BUFFER_MS
          animating = true
        }
        return true
      }
      return a.opacity > 0
    })

    // Interpolate inspect
    for (const a of this.inspectAnims) {
      if (a.initialized && interpolate(a, LAYER_STYLES.inspect.lerpFactor)) animating = true
    }

    this.composite()
    if (animating) this.frameId = requestAnimationFrame(() => this.tick())
  }

  private renderLayer(name: LayerName, anims: AnimatedBounds[], opts?: { fading?: boolean }) {
    const layer = this.layers[name]
    if (!layer.ctx) return
    layer.ctx.clearRect(0, 0, this.w, this.h)
    const style = LAYER_STYLES[name]
    for (const a of anims) {
      const opacity = opts?.fading ? 0 : a.opacity
      drawRoundedRect(layer.ctx, a.current.x, a.current.y, a.current.width, a.current.height, a.borderRadius, style.fillColor, style.borderColor, opacity)
    }
  }

  private composite() {
    if (!this.mainCtx) return
    this.mainCtx.setTransform(1, 0, 0, 1, 0, 0)
    this.mainCtx.clearRect(0, 0, this.canvas.width, this.canvas.height)
    this.mainCtx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)

    // Render each layer
    this.renderLayer('inspect', this.inspectAnims)
    this.renderLayer('drag', this.dragAnim ? [this.dragAnim] : [])
    this.renderLayer('selection', this.selectionAnims, { fading: this.selectionFading })
    this.renderLayer('grabbed', this.grabbedAnims)

    // Composite
    const order: LayerName[] = ['inspect', 'drag', 'selection', 'grabbed']
    for (const name of order) {
      const lc = this.layers[name].canvas
      if (lc) this.mainCtx.drawImage(lc, 0, 0, this.w, this.h)
    }
  }
}
