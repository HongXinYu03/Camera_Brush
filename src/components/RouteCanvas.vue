<script setup lang="ts">
import { ref, shallowRef, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import type {
  Task,
  ImageAsset,
  BrushProfile,
  Stroke,
  Point,
  Viewport,
  Tool,
  RawPoint,
  ObjectAnnotation,
} from '../lib/types'
import { clone, uid } from '../lib/types'
import {
  imagePoint,
  geometry,
  createWidthSampler,
  clamp,
  hitStroke,
  prepareEdit,
  distance,
  segmentDistance,
  arcSection,
  pointAt,
  renderStroke,
} from '../lib/geometry'
const props = defineProps<{
  task: Task
  asset: ImageAsset
  url: string
  brush: BrushProfile
  tool: Tool
  selected: string
  raw: boolean
  helpers: boolean
  objects: boolean
  section: [number, number] | null
  playing: boolean
  playback: number
}>()
const emit = defineEmits<{
  before: []
  change: [kind: 'route' | 'object']
  select: [id: string]
  position: [point: Point]
  viewport: [value: Viewport]
  width: [width: number]
  message: [text: string]
}>()
const host = ref<HTMLDivElement>(),
  surface = ref<HTMLCanvasElement>(),
  viewport = ref<Viewport>({
    scale: 0.5,
    translate_x: 0,
    translate_y: 0,
    device_pixel_ratio: window.devicePixelRatio || 1,
  })
const dimensions = ref({ width: 800, height: 600 }),
  draft = shallowRef<Stroke | null>(null),
  polygon = ref<Point[]>([]),
  vertex = ref(-1),
  hover = ref<Point | null>(null),
  space = ref(false)
let bitmap: ImageBitmap | null = null,
  observer: ResizeObserver | undefined,
  raf = 0,
  cacheDirty = true,
  base = document.createElement('canvas')
let dragging: {
  kind: 'draw' | 'pan' | 'move' | 'vertex' | 'box'
  start: Point
  viewport: Viewport
  original?: Point[]
  vertex?: number
  stroke?: Stroke
  end?: Point
} | null = null
let startTime = 0,
  captured = -1,
  initial = true,
  disposed = false
let widthSampler: ReturnType<typeof createWidthSampler> | null = null
const cssPoint = (e: PointerEvent | MouseEvent | WheelEvent) => {
  const r = surface.value!.getBoundingClientRect()
  return { x: e.clientX - r.left, y: e.clientY - r.top }
}
const inside = (p: Point) =>
  p.x >= 0 && p.y >= 0 && p.x <= props.asset.width && p.y <= props.asset.height
const activeStroke = () => props.task.strokes.find((s) => s.stroke_id === props.selected)
function requestDraw(invalidate = false) {
  cacheDirty ||= invalidate
  if (!raf)
    raf = requestAnimationFrame(() => {
      raf = 0
      draw()
    })
}
function setTransform(ctx: CanvasRenderingContext2D) {
  const dpr = viewport.value.device_pixel_ratio
  ctx.setTransform(
    dpr * viewport.value.scale,
    0,
    0,
    dpr * viewport.value.scale,
    dpr * viewport.value.translate_x,
    dpr * viewport.value.translate_y,
  )
}
function drawBase() {
  const canvas = surface.value
  if (!canvas) return
  base.width = canvas.width
  base.height = canvas.height
  const c = base.getContext('2d')!
  setTransform(c)
  if (bitmap) c.drawImage(bitmap, 0, 0, props.asset.width, props.asset.height)
  c.save()
  c.beginPath()
  c.rect(0, 0, props.asset.width, props.asset.height)
  c.clip()
  for (const s of props.task.strokes)
    renderStroke(c, s, {
      raw: props.raw,
      helpers: props.helpers,
      selected: props.selected === s.stroke_id,
    })
  if (props.objects)
    for (const [i, o] of props.asset.objects.entries()) {
      c.fillStyle = '#387eae19'
      c.strokeStyle = '#377ca4'
      c.lineWidth = 1.5 / viewport.value.scale
      c.setLineDash([7 / viewport.value.scale, 4 / viewport.value.scale])
      c.beginPath()
      o.points.forEach((p, j) => (j ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y)))
      c.closePath()
      c.fill()
      c.stroke()
      c.setLineDash([])
      const p = o.points[0]!
      c.fillStyle = '#285a77'
      c.font = `${12 / viewport.value.scale}px sans-serif`
      c.fillText(`${i + 1} ${o.label}`, p.x, p.y - 7 / viewport.value.scale)
    }
  c.restore()
  cacheDirty = false
}
function draw() {
  const canvas = surface.value
  if (!canvas) return
  if (cacheDirty) drawBase()
  const c = canvas.getContext('2d')!
  c.setTransform(1, 0, 0, 1, 0, 0)
  c.clearRect(0, 0, canvas.width, canvas.height)
  c.drawImage(base, 0, 0)
  setTransform(c)
  c.save()
  c.beginPath()
  c.rect(0, 0, props.asset.width, props.asset.height)
  c.clip()
  if (draft.value) renderStroke(c, draft.value)
  const stroke = activeStroke(),
    pts = stroke ? geometry(stroke, props.raw) : []
  if (props.section && pts.length) {
    const path = arcSection(pts, props.section[0], props.section[1])
    c.strokeStyle = '#f6ca5a'
    c.lineWidth = 5 / viewport.value.scale
    c.lineCap = 'round'
    c.beginPath()
    path.forEach((p, i) => (i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y)))
    c.stroke()
  }
  if (props.tool === 'edit' && stroke) {
    const handles = geometry(stroke)
    // Editing is explicitly simplified once before the user drags handles.
    for (const [i, p] of handles.entries()) {
      c.fillStyle = i === vertex.value ? '#52525b' : '#fff'
      c.strokeStyle = '#52525b'
      c.lineWidth = 1.5 / viewport.value.scale
      c.beginPath()
      c.arc(p.x, p.y, 4 / viewport.value.scale, 0, Math.PI * 2)
      c.fill()
      c.stroke()
    }
  }
  if (props.playing && pts.length) {
    const p = pointAt(pts, props.playback)
    c.fillStyle = '#fff'
    c.strokeStyle = '#52525b'
    c.lineWidth = 3 / viewport.value.scale
    c.beginPath()
    c.arc(p.x, p.y, 7 / viewport.value.scale, 0, Math.PI * 2)
    c.fill()
    c.stroke()
  }
  if (dragging?.kind === 'box' && dragging.end) {
    c.strokeStyle = '#377ca4'
    c.lineWidth = 2 / viewport.value.scale
    c.strokeRect(
      dragging.start.x,
      dragging.start.y,
      dragging.end.x - dragging.start.x,
      dragging.end.y - dragging.start.y,
    )
  }
  if (polygon.value.length) {
    c.strokeStyle = '#377ca4'
    c.fillStyle = '#377ca4'
    c.lineWidth = 2 / viewport.value.scale
    c.beginPath()
    polygon.value.forEach((p, i) => (i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y)))
    if (hover.value) c.lineTo(hover.value.x, hover.value.y)
    c.stroke()
    polygon.value.forEach((p) => {
      c.beginPath()
      c.arc(p.x, p.y, 4 / viewport.value.scale, 0, Math.PI * 2)
      c.fill()
    })
  }
  c.restore()
}
function publishViewport() {
  emit('viewport', clone(viewport.value))
  requestDraw(true)
}
function fit() {
  if (draft.value) return
  const { width: w, height: h } = dimensions.value,
    pad = 46
  const scale = Math.min((w - pad * 2) / props.asset.width, (h - pad * 2) / props.asset.height)
  viewport.value = {
    ...viewport.value,
    scale: Math.max(0.01, scale),
    translate_x: (w - props.asset.width * scale) / 2,
    translate_y: (h - props.asset.height * scale) / 2,
  }
  publishViewport()
}
function zoom(scale: number, center?: Point) {
  if (draft.value || dragging) return
  const p = center || { x: dimensions.value.width / 2, y: dimensions.value.height / 2 },
    world = imagePoint(p, viewport.value)
  viewport.value.scale = clamp(scale, 0.02, 8)
  viewport.value.translate_x = p.x - world.x * viewport.value.scale
  viewport.value.translate_y = p.y - world.y * viewport.value.scale
  publishViewport()
}
function wheel(e: WheelEvent) {
  e.preventDefault()
  if (!draft.value && !dragging)
    zoom(viewport.value.scale * Math.exp(-e.deltaY * 0.0015), cssPoint(e))
}
function makeRaw(e: PointerEvent, p: Point): RawPoint {
  const css = cssPoint(e),
    pen = e.pointerType === 'pen' && Number.isFinite(e.pressure) && e.pressure > 0
  return {
    x: p.x,
    y: p.y,
    capture_css_x: css.x,
    capture_css_y: css.y,
    t_ms: Math.max(0, e.timeStamp - startTime),
    pressure: pen ? e.pressure : null,
    event_pressure_raw: Number.isFinite(e.pressure) ? e.pressure : null,
    pressure_source: pen ? 'pen' : 'unavailable',
    sample_index: draft.value?.raw_points.length || 0,
  }
}
function addSample(e: PointerEvent) {
  if (!draft.value) return
  const p = imagePoint(cssPoint(e), draft.value.brush_profile.capture_viewport)
  if (!inside(p)) {
    finish(false)
    return
  }
  const raw = makeRaw(e, p),
    last = draft.value.raw_points.at(-1)
  if (
    last &&
    (raw.t_ms < last.t_ms ||
      (raw.t_ms === last.t_ms &&
        raw.capture_css_x === last.capture_css_x &&
        raw.capture_css_y === last.capture_css_y))
  )
    return
  draft.value.raw_points.push(raw)
  draft.value.width_profile.push(widthSampler!(raw, draft.value.raw_points.length - 1))
  draft.value.pressure_available ||= raw.pressure !== null
  emit('width', draft.value.width_profile.at(-1)!.width_image_px * viewport.value.scale)
  requestDraw()
}
function capture(e: PointerEvent) {
  captured = e.pointerId
  surface.value!.setPointerCapture(e.pointerId)
}
function pointerDown(e: PointerEvent) {
  if (e.button !== 0 || dragging) return
  surface.value!.focus()
  const css = cssPoint(e),
    p = imagePoint(css, viewport.value)
  if (space.value || props.tool === 'pan') {
    dragging = { kind: 'pan', start: css, viewport: clone(viewport.value) }
    capture(e)
    return
  }
  if (!inside(p)) return
  if (props.tool === 'draw') {
    startTime = e.timeStamp
    const profile = clone(props.brush)
    profile.capture_viewport = clone(viewport.value)
    widthSampler = createWidthSampler(profile)
    draft.value = {
      stroke_id: uid(),
      order: props.task.strokes.length,
      pointer_type: e.pointerType,
      pressure_available: false,
      raw_points: [],
      edited_points: null,
      processed_points: null,
      active_geometry: 'raw',
      reversed: false,
      brush_profile: profile,
      width_profile: [],
      edited_widths: null,
      cancelled: false,
      width_transfer_policy: 'original',
      width_transfer_confirmed: true,
    }
    dragging = { kind: 'draw', start: p, viewport: clone(viewport.value) }
    capture(e)
    addSample(e)
    return
  }
  if (props.tool === 'polygon') {
    polygon.value.push(p)
    requestDraw()
    return
  }
  if (props.tool === 'box') {
    dragging = { kind: 'box', start: p, viewport: clone(viewport.value), end: p }
    capture(e)
    return
  }
  const selected = activeStroke()
  if (props.tool === 'edit' && selected) {
    const index = geometry(selected).findIndex((q) => distance(q, p) < 9 / viewport.value.scale)
    if (index >= 0) {
      vertex.value = index
      if (e.altKey) {
        removeVertex()
        return
      }
      emit('before')
      dragging = {
        kind: 'vertex',
        start: p,
        viewport: clone(viewport.value),
        stroke: selected,
        vertex: index,
      }
      capture(e)
      return
    }
  }
  const found = [...props.task.strokes]
    .reverse()
    .find((s) => hitStroke(p, s, 12 / viewport.value.scale))
  emit('select', found?.stroke_id || '')
  vertex.value = -1
  if (found && props.tool === 'select') {
    emit('before')
    prepareEdit(found, 1)
    dragging = {
      kind: 'move',
      start: p,
      viewport: clone(viewport.value),
      stroke: found,
      original: clone(geometry(found)),
    }
    capture(e)
  }
  requestDraw(true)
}
function pointerMove(e: PointerEvent) {
  const css = cssPoint(e),
    p = imagePoint(css, viewport.value)
  hover.value = p
  emit('position', p)
  if (!dragging) {
    if (polygon.value.length) requestDraw()
    return
  }
  if (e.pointerId !== captured) return
  if (dragging.kind === 'draw') {
    const events = e.getCoalescedEvents?.() || []
    const samples = events.length ? events : [e]
    for (const sample of [...samples].sort((a, b) => a.timeStamp - b.timeStamp)) {
      if (!draft.value) break
      addSample(sample)
    }
  } else if (dragging.kind === 'pan') {
    viewport.value.translate_x = dragging.viewport.translate_x + css.x - dragging.start.x
    viewport.value.translate_y = dragging.viewport.translate_y + css.y - dragging.start.y
    publishViewport()
  } else if (dragging.kind === 'box') {
    dragging.end = { x: clamp(p.x, 0, props.asset.width), y: clamp(p.y, 0, props.asset.height) }
    requestDraw()
  } else if (dragging.kind === 'vertex' && dragging.stroke?.edited_points) {
    dragging.stroke.edited_points[dragging.vertex!] = {
      x: clamp(p.x, 0, props.asset.width),
      y: clamp(p.y, 0, props.asset.height),
    }
    requestDraw(true)
  } else if (dragging.kind === 'move' && dragging.original && dragging.stroke) {
    const original = dragging.original,
      minX = Math.min(...original.map((q) => q.x)),
      maxX = Math.max(...original.map((q) => q.x)),
      minY = Math.min(...original.map((q) => q.y)),
      maxY = Math.max(...original.map((q) => q.y))
    const dx = clamp(p.x - dragging.start.x, -minX, props.asset.width - maxX),
      dy = clamp(p.y - dragging.start.y, -minY, props.asset.height - maxY)
    dragging.stroke.edited_points = original.map((q) => ({ x: q.x + dx, y: q.y + dy }))
    requestDraw(true)
  }
}
function addObject(points: Point[], shape: 'box' | 'polygon') {
  emit('before')
  const o: ObjectAnnotation = {
    id: uid(),
    label: `对象 ${props.asset.objects.length + 1}`,
    category: 'target',
    geometry: shape,
    points,
    revision_id: uid(),
  }
  props.asset.objects.push(o)
  emit('change', 'object')
  requestDraw(true)
}
function finish(cancelled: boolean) {
  const drag = dragging
  dragging = null
  if (surface.value && captured >= 0 && surface.value.hasPointerCapture(captured))
    surface.value.releasePointerCapture(captured)
  captured = -1
  if (draft.value) {
    if (draft.value.raw_points.length > 1) {
      emit('before')
      const s = draft.value
      s.cancelled = cancelled
      props.task.strokes.push(s)
      props.task.active_drawing_ms += s.raw_points.at(-1)!.t_ms
      emit('select', s.stroke_id)
      emit('change', 'route')
      if (cancelled) emit('message', '未完成笔划已保留，可在路线列表恢复。')
    }
    draft.value = null
    widthSampler = null
  } else if (drag?.kind === 'move' || drag?.kind === 'vertex') emit('change', 'route')
  else if (
    drag?.kind === 'box' &&
    drag.end &&
    distance(drag.start, drag.end) > 8 / viewport.value.scale &&
    !cancelled
  ) {
    const a = drag.start,
      b = drag.end,
      x0 = Math.min(a.x, b.x),
      y0 = Math.min(a.y, b.y),
      x1 = Math.max(a.x, b.x),
      y1 = Math.max(a.y, b.y)
    addObject(
      [
        { x: x0, y: y0 },
        { x: x1, y: y0 },
        { x: x1, y: y1 },
        { x: x0, y: y1 },
      ],
      'box',
    )
  }
  requestDraw(true)
}
function finishPolygon() {
  if (polygon.value.length >= 3) addObject(clone(polygon.value), 'polygon')
  polygon.value = []
  requestDraw(true)
}
function doubleClick(e: MouseEvent) {
  if (props.tool === 'polygon') {
    if (polygon.value.length > 1 && distance(polygon.value.at(-1)!, polygon.value.at(-2)!) < 0.01)
      polygon.value.pop()
    finishPolygon()
    return
  }
  const s = activeStroke()
  if (props.tool !== 'edit' || !s?.edited_points) return
  const p = imagePoint(cssPoint(e), viewport.value),
    pts = s.edited_points
  let min = 14 / viewport.value.scale,
    index = -1
  for (let i = 1; i < pts.length; i++) {
    const d = segmentDistance(p, pts[i - 1]!, pts[i]!)
    if (d < min) {
      min = d
      index = i
    }
  }
  if (index >= 0 && inside(p)) {
    emit('before')
    const a = pts[index - 1]!,
      b = pts[index]!
    const dx = b.x - a.x,
      dy = b.y - a.y
    const fraction = clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1), 0, 1)
    const width =
      s.edited_widths![index - 1]! * (1 - fraction) + s.edited_widths![index]! * fraction
    pts.splice(index, 0, p)
    s.edited_widths!.splice(index, 0, width)
    vertex.value = index
    emit('change', 'route')
    requestDraw(true)
  }
}
function removeVertex() {
  const s = activeStroke()
  if (!s?.edited_points || vertex.value < 0) {
    emit('message', '请先选中一个顶点。')
    return
  }
  if (s.edited_points.length <= 2) {
    emit('message', '路线至少保留两个顶点。')
    return
  }
  emit('before')
  s.edited_points.splice(vertex.value, 1)
  s.edited_widths!.splice(vertex.value, 1)
  vertex.value = -1
  emit('change', 'route')
  requestDraw(true)
}
function editSelected() {
  const s = activeStroke()
  if (!s || s.active_geometry === 'edited') return
  emit('before')
  prepareEdit(s, 2 / viewport.value.scale)
  emit('change', 'route')
  requestDraw(true)
}
function keyDown(e: KeyboardEvent) {
  if ((e.target as HTMLElement)?.matches('input,textarea,select,[contenteditable=true]')) return
  if (e.code === 'Space') {
    e.preventDefault()
    space.value = true
  }
  if (e.key === 'Escape') {
    finish(true)
    polygon.value = []
    requestDraw()
  }
  if (e.key === 'Enter' && props.tool === 'polygon') finishPolygon()
}
function keyUp(e: KeyboardEvent) {
  if (e.code === 'Space') space.value = false
}
function blur() {
  space.value = false
  finish(true)
}
function navigate(e: MouseEvent) {
  if (draft.value || dragging) return
  const r = (e.currentTarget as HTMLElement).getBoundingClientRect(),
    x = ((e.clientX - r.left) / r.width) * props.asset.width,
    y = ((e.clientY - r.top) / r.height) * props.asset.height
  viewport.value.translate_x = dimensions.value.width / 2 - x * viewport.value.scale
  viewport.value.translate_y = dimensions.value.height / 2 - y * viewport.value.scale
  publishViewport()
}
watch(
  () => [
    props.task.strokes,
    props.selected,
    props.raw,
    props.helpers,
    props.objects,
    props.asset.objects,
  ],
  () => requestDraw(true),
  { deep: true },
)
watch(
  () => [props.section, props.playing, props.playback],
  () => requestDraw(),
  { deep: true },
)
watch(
  () => props.tool,
  () => {
    finish(true)
    polygon.value = []
    if (props.tool === 'edit') editSelected()
  },
)
watch(
  () => props.url,
  async (url) => {
    if (!url) return
    const b = await createImageBitmap(await (await fetch(url)).blob())
    if (disposed) {
      b.close()
      return
    }
    bitmap?.close()
    bitmap = b
    requestDraw(true)
  },
  { immediate: true },
)
onMounted(async () => {
  await nextTick()
  observer = new ResizeObserver((entries) => {
    const rect = entries[0]!.contentRect
    dimensions.value = { width: rect.width, height: rect.height }
    const dpr = window.devicePixelRatio || 1
    viewport.value.device_pixel_ratio = dpr
    if (surface.value) {
      surface.value.width = Math.round(rect.width * dpr)
      surface.value.height = Math.round(rect.height * dpr)
    }
    if (initial) {
      fit()
      initial = false
    } else requestDraw(true)
  })
  observer.observe(host.value!)
  window.addEventListener('keydown', keyDown)
  window.addEventListener('keyup', keyUp)
  window.addEventListener('blur', blur)
})
onBeforeUnmount(() => {
  disposed = true
  finish(true)
  observer?.disconnect()
  cancelAnimationFrame(raf)
  bitmap?.close()
  window.removeEventListener('keydown', keyDown)
  window.removeEventListener('keyup', keyUp)
  window.removeEventListener('blur', blur)
})
defineExpose({
  fit,
  zoom,
  removeVertex,
  finishPolygon,
  editSelected,
  cancel: () => finish(true),
  refresh: () => requestDraw(true),
})
</script>
<template>
  <div ref="host" class="canvas-host" :class="[`tool-${tool}`, { 'is-panning': space }]">
    <canvas
      ref="surface"
      class="route-canvas"
      tabindex="0"
      aria-label="场景路线画布"
      data-testid="route-canvas"
      @pointerdown.prevent="pointerDown"
      @pointermove="pointerMove"
      @pointerup="finish(false)"
      @pointercancel="finish(true)"
      @lostpointercapture="dragging && finish(true)"
      @dblclick.prevent="doubleClick"
      @wheel="wheel"
      @contextmenu.prevent
    />
    <div class="canvas-image-label">
      <span class="tiny-square" /> {{ asset.original_name }}
      <span>{{ asset.width }} × {{ asset.height }}</span>
    </div>
    <div v-if="tool === 'polygon'" class="canvas-tip">
      单击添加顶点 · 双击或 Enter 完成 · Esc 取消
    </div>
    <div v-else-if="tool === 'edit'" class="canvas-tip">
      拖动顶点修改 · 双击路线插点 · Alt + 单击删点
    </div>
    <div v-else-if="!task.strokes.length" class="canvas-tip">按住并拖动，画出你的相机路线</div>
    <button class="minimap" title="点击缩略图定位视口" aria-label="缩略导航" @click="navigate">
      <img :src="url" alt="场景缩略导航" /><span
        :style="{
          left: `${clamp(-viewport.translate_x / viewport.scale / asset.width, 0, 1) * 100}%`,
          top: `${clamp(-viewport.translate_y / viewport.scale / asset.height, 0, 1) * 100}%`,
          width: `${Math.min(1, dimensions.width / viewport.scale / asset.width) * 100}%`,
          height: `${Math.min(1, dimensions.height / viewport.scale / asset.height) * 100}%`,
        }"
      />
    </button>
  </div>
</template>
