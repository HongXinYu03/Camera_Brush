import type { Point, Stroke, Viewport, BrushProfile, RawPoint, WidthPoint } from './types.ts'
export const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n))
export const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y)
export const imagePoint = (p: Point, v: Viewport): Point => ({
  x: (p.x - v.translate_x) / v.scale,
  y: (p.y - v.translate_y) / v.scale,
})
export const screenPoint = (p: Point, v: Viewport): Point => ({
  x: p.x * v.scale + v.translate_x,
  y: p.y * v.scale + v.translate_y,
})
export function validateBrush(b: BrushProfile) {
  return (
    [
      b.w_min_css_px,
      b.w_max_css_px,
      b.v_slow_css_px_ms,
      b.v_fast_css_px_ms,
      b.gamma,
      b.tau_ms,
      b.gap_reset_ms,
      b.capture_viewport.scale,
    ].every(Number.isFinite) &&
    b.w_min_css_px > 0 &&
    b.w_max_css_px > b.w_min_css_px &&
    b.w_max_css_px <= 100 &&
    b.v_slow_css_px_ms >= 0 &&
    b.v_fast_css_px_ms > b.v_slow_css_px_ms &&
    b.gamma > 0 &&
    b.tau_ms > 0 &&
    b.gap_reset_ms > 0 &&
    b.capture_viewport.scale > 0
  )
}
export function deriveWidth(points: RawPoint[], b: BrushProfile): WidthPoint[] {
  return points.map(createWidthSampler(b))
}
export function createWidthSampler(b: BrushProfile): (p: RawPoint, i: number) => WidthPoint {
  if (!validateBrush(b))
    throw new Error('笔刷参数无效：最粗宽度必须大于最细宽度，高速阈值必须大于低速阈值。')
  let filtered: number | null = null
  let width = (b.w_min_css_px + b.w_max_css_px) / 2
  let prev: RawPoint | undefined
  return (p, i) => {
    const dt = prev ? p.t_ms - prev.t_ms : 0
    const gap = dt > b.gap_reset_ms
    let raw: number | null = null
    if (gap) filtered = null
    else if (prev && dt > 0 && b.mode === 'velocity') {
      raw =
        Math.hypot(p.capture_css_x - prev.capture_css_x, p.capture_css_y - prev.capture_css_y) / dt
      const alpha = 1 - Math.exp(-dt / b.tau_ms)
      filtered = filtered === null ? raw : alpha * raw + (1 - alpha) * filtered
      const u =
        clamp((filtered - b.v_slow_css_px_ms) / (b.v_fast_css_px_ms - b.v_slow_css_px_ms), 0, 1) **
        b.gamma
      width =
        b.direction === 'slow_thick'
          ? b.w_max_css_px - (b.w_max_css_px - b.w_min_css_px) * u
          : b.w_min_css_px + (b.w_max_css_px - b.w_min_css_px) * u
    }
    prev = p
    return {
      source_index: i,
      speed_raw_css_px_ms: raw,
      speed_filtered_css_px_ms: filtered,
      width_image_px:
        (b.mode === 'fixed' ? (b.w_min_css_px + b.w_max_css_px) / 2 : width) /
        b.capture_viewport.scale,
      initialization: i === 0,
      gap,
    }
  }
}
export function geometry(stroke: Stroke, raw = false): Point[] {
  if (!raw && stroke.active_geometry === 'edited' && stroke.edited_points)
    return stroke.edited_points
  return stroke.reversed && !raw ? [...stroke.raw_points].reverse() : stroke.raw_points
}
export function widths(stroke: Stroke, raw = false): number[] {
  if (!raw && stroke.active_geometry === 'edited' && stroke.edited_widths)
    return stroke.edited_widths
  const w = stroke.width_profile.map((p) => p.width_image_px)
  return stroke.reversed && !raw ? w.reverse() : w
}
export function arcLengths(points: Point[]) {
  const result = [0]
  for (let i = 1; i < points.length; i++)
    result.push(result[i - 1]! + distance(points[i - 1]!, points[i]!))
  return result
}
export function pointAt(points: Point[], s: number): Point {
  if (!points.length) return { x: 0, y: 0 }
  const lengths = arcLengths(points),
    target = clamp(s, 0, 1) * lengths.at(-1)!
  for (let i = 1; i < points.length; i++)
    if (lengths[i]! >= target) {
      const f = (target - lengths[i - 1]!) / (lengths[i]! - lengths[i - 1]! || 1)
      return {
        x: points[i - 1]!.x + (points[i]!.x - points[i - 1]!.x) * f,
        y: points[i - 1]!.y + (points[i]!.y - points[i - 1]!.y) * f,
      }
    }
  return points.at(-1)!
}
export function arcSection(points: Point[], start: number, end: number) {
  const ls = arcLengths(points),
    total = ls.at(-1) || 1
  return [
    pointAt(points, start),
    ...points.filter((_, i) => ls[i]! / total > start && ls[i]! / total < end),
    pointAt(points, end),
  ]
}
export function segmentDistance(p: Point, a: Point, b: Point) {
  const dx = b.x - a.x,
    dy = b.y - a.y
  const t = clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1), 0, 1)
  return distance(p, { x: a.x + t * dx, y: a.y + t * dy })
}
export function hitStroke(p: Point, stroke: Stroke, tolerance: number) {
  const pts = geometry(stroke)
  return pts.some((q, i) =>
    i ? segmentDistance(p, pts[i - 1]!, q) < tolerance : distance(p, q) < tolerance,
  )
}
export function simplifyIndices(points: Point[], tolerance: number): number[] {
  if (points.length < 3) return points.map((_, i) => i)
  const keep = new Set([0, points.length - 1]),
    stack = [[0, points.length - 1]]
  while (stack.length) {
    const [a, b] = stack.pop()!,
      first = a!,
      last = b!
    let max = tolerance,
      index = -1
    for (let i = first + 1; i < last; i++) {
      const d = segmentDistance(points[i]!, points[first]!, points[last]!)
      if (d > max) {
        max = d
        index = i
      }
    }
    if (index >= 0) {
      keep.add(index)
      stack.push([first, index], [index, last])
    }
  }
  return [...keep].sort((a, b) => a - b)
}
export function prepareEdit(stroke: Stroke, tolerance = 2) {
  if (stroke.active_geometry === 'edited') return
  const pts = geometry(stroke),
    ws = widths(stroke),
    indices = simplifyIndices(pts, tolerance)
  stroke.edited_points = indices.map((i) => ({ ...pts[i]! }))
  stroke.edited_widths = indices.map((i) => ws[i]!)
  stroke.active_geometry = 'edited'
  stroke.simplification = { method: 'ramer-douglas-peucker', tolerance_image_px: tolerance }
  stroke.width_transfer_policy = 'source-arc-length-correspondence'
  stroke.width_transfer_confirmed = stroke.brush_profile.width_semantics === 'visual_only'
}
// Each segment is a quadrilateral plus endpoint discs. Widths are full diameters;
// no simulated pressure, taper or centerline displacement enters this renderer.
export function renderStroke(
  ctx: CanvasRenderingContext2D,
  stroke: Stroke,
  options: { raw?: boolean; selected?: boolean; helpers?: boolean } = {},
) {
  const pts = geometry(stroke, options.raw),
    ws = widths(stroke, options.raw)
  if (!pts.length) return
  ctx.fillStyle = stroke.brush_profile.color
  ctx.save()
  if (stroke.cancelled) ctx.globalAlpha = 0.45
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!,
      radius = (ws[i] || 3) / 2
    if (i) {
      const a = pts[i - 1]!,
        r0 = (ws[i - 1] || 3) / 2,
        len = distance(a, p) || 1
      const nx = -(p.y - a.y) / len,
        ny = (p.x - a.x) / len
      ctx.beginPath()
      ctx.moveTo(a.x + nx * r0, a.y + ny * r0)
      ctx.lineTo(p.x + nx * radius, p.y + ny * radius)
      ctx.lineTo(p.x - nx * radius, p.y - ny * radius)
      ctx.lineTo(a.x - nx * r0, a.y - ny * r0)
      ctx.closePath()
      ctx.fill()
    }
    ctx.beginPath()
    ctx.arc(p.x, p.y, radius, 0, Math.PI * 2)
    ctx.fill()
  }
  if (options.selected) {
    ctx.strokeStyle = '#fff'
    ctx.lineWidth = 1
    ctx.setLineDash([5, 5])
    ctx.beginPath()
    pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)))
    ctx.stroke()
    ctx.setLineDash([])
  }
  if (options.helpers && pts.length > 1) {
    const first = pts[0]!,
      last = pts.at(-1)!,
      prev = pts[Math.max(0, pts.length - 4)]!
    const size = Math.max(12, (ws.at(-1) || 3) * 1.4)
    const angle = Math.atan2(last.y - prev.y, last.x - prev.x)
    ctx.fillStyle = '#52525b'
    ctx.strokeStyle = '#fff'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.arc(first.x, first.y, Math.max(6, (ws[0] || 3) * 0.8), 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()
    ctx.fillStyle = stroke.brush_profile.color
    ctx.beginPath()
    ctx.moveTo(last.x + Math.cos(angle) * size * 0.6, last.y + Math.sin(angle) * size * 0.6)
    ctx.lineTo(last.x - Math.cos(angle - 0.55) * size, last.y - Math.sin(angle - 0.55) * size)
    ctx.lineTo(last.x - Math.cos(angle + 0.55) * size, last.y - Math.sin(angle + 0.55) * size)
    ctx.closePath()
    ctx.fill()
  }
  ctx.restore()
}
