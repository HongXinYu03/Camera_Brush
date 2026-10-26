import { test } from 'node:test'
import assert from 'node:assert/strict'
import { deflateRawSync } from 'node:zlib'
import { defaultBrush, newProject, newTask, clone, uid, now } from '../src/lib/types.ts'
import type { RawPoint, ImageAsset, Stroke, Point, BrushProfile } from '../src/lib/types.ts'
import {
  imagePoint,
  screenPoint,
  deriveWidth,
  geometry,
  widths,
  prepareEdit,
  renderStroke,
  pointAt,
  arcSection,
  arcLengths,
} from '../src/lib/geometry.ts'
import {
  inputOnly,
  validateProject,
  validateUnits,
  recordRevision,
  routeSVG,
  taskIssues,
} from '../src/lib/data.ts'
import { makeZip, readZip, crc32 } from '../src/lib/zip.ts'
const points = (speed = 0.3, hz = 120, duration = 1000): RawPoint[] =>
  Array.from({ length: Math.floor((duration * hz) / 1000) + 1 }, (_, i) => {
    const t = (i * 1000) / hz
    return {
      x: speed * t,
      y: 100,
      capture_css_x: speed * t,
      capture_css_y: 100,
      t_ms: t,
      pressure: null,
      event_pressure_raw: 0.5,
      pressure_source: 'unavailable',
      sample_index: i,
    }
  })
const image = (): ImageAsset => ({
  id: uid(),
  original_name: 'SECRET_FILENAME.png',
  width: 1600,
  height: 900,
  original_width: 1600,
  original_height: 900,
  sha256: 'a'.repeat(64),
  source_sha256: 'b'.repeat(64),
  source_type: 'uploaded',
  scene: 'SECRET_SCENE',
  style: 'test',
  perspective: 'unknown',
  difficulty: 'unknown',
  scene_family_id: uid(),
  split: 'unassigned',
  license: '',
  generator: null,
  generator_version: null,
  prompt: 'SECRET_PROMPT',
  seed: null,
  created_at: now(),
  objects: [],
  object_revisions: [],
})
function fixture() {
  const p = newProject('test'),
    img = image(),
    t = newTask(img.id, 1),
    raw = points(),
    b = defaultBrush()
  const s: Stroke = {
    stroke_id: uid(),
    order: 0,
    pointer_type: 'mouse',
    pressure_available: false,
    raw_points: raw,
    edited_points: null,
    processed_points: null,
    active_geometry: 'raw',
    reversed: false,
    brush_profile: b,
    width_profile: deriveWidth(raw, b),
    edited_widths: null,
    cancelled: false,
    width_transfer_policy: 'original',
    width_transfer_confirmed: true,
  }
  p.images.push(img)
  p.tasks.push(t)
  t.strokes.push(s)
  return { p, img, t, s }
}
test('image coordinates round-trip at 50/100/200%, with pan and DPR 1/2', () => {
  for (const scale of [0.5, 1, 2])
    for (const dpr of [1, 2])
      for (const p of [
        { x: 0, y: 0 },
        { x: 1600, y: 900 },
        { x: 13.7, y: 621.3 },
      ]) {
        const v = { scale, translate_x: -76.42, translate_y: 153.7, device_pixel_ratio: dpr }
        const r = imagePoint(screenPoint(p, v), v)
        assert.ok(Math.hypot(r.x - p.x, r.y - p.y) < 1e-8)
      }
})
test('slow/fast mapping and the reverse condition retain correct width ordering', () => {
  const b = defaultBrush(),
    slow = deriveWidth(points(0.2), b).slice(20),
    fast = deriveWidth(points(0.9), b).slice(20)
  assert.ok(slow[0]!.width_image_px > fast[0]!.width_image_px)
  b.direction = 'fast_thick'
  assert.ok(
    deriveWidth(points(0.2), b)[20]!.width_image_px <
      deriveWidth(points(0.9), b)[20]!.width_image_px,
  )
})
test('30/60/120/240Hz width profiles agree within 5% of width range', (t) => {
  const b = defaultBrush()
  const profile = (hz: number) => {
    const raw = points(1, hz, 1600).map((p) => ({
      ...p,
      x: 0.1 * p.t_ms + 0.0003 * p.t_ms ** 2,
      capture_css_x: 0.1 * p.t_ms + 0.0003 * p.t_ms ** 2,
    }))
    return { raw, derived: deriveWidth(raw, b) }
  }
  const baseline = profile(240)
  for (const hz of [30, 60, 120]) {
    const p = profile(hz)
    let sum = 0,
      n = 0
    for (let ms = 250; ms <= 1500; ms += 10) {
      const idx = (ms * hz) / 1000,
        lo = Math.floor(idx),
        f = idx - lo,
        w =
          p.derived[lo]!.width_image_px * (1 - f) +
          p.derived[Math.min(lo + 1, p.derived.length - 1)]!.width_image_px * f
      const bi = Math.round((ms * 240) / 1000)
      sum += Math.abs(w - baseline.derived[bi]!.width_image_px)
      n++
    }
    const mae = sum / n
    t.diagnostic(
      `${hz}Hz vs 240Hz: MAE ${mae.toFixed(4)} CSS px (${((mae / 9) * 100).toFixed(2)}% of range)`,
    )
    assert.ok(mae < 9 * 0.05)
  }
})
test('duplicate timestamps, stationary points and one-second gaps stay finite', () => {
  const b = defaultBrush(),
    raw = points(0.4).slice(0, 5)
  raw.push({ ...raw.at(-1)!, x: 10, capture_css_x: 10 })
  raw.push({ ...raw.at(-1)!, t_ms: 1100 })
  raw.push({ ...raw.at(-1)!, t_ms: 1110, x: 14, capture_css_x: 14 })
  const d = deriveWidth(raw, b)
  assert.ok(d.every((v) => Number.isFinite(v.width_image_px)))
  assert.equal(d[5]!.width_image_px, d[4]!.width_image_px)
  assert.ok(d[6]!.gap)
  assert.equal(d[6]!.width_image_px, d[5]!.width_image_px)
  assert.equal(d[0]!.width_image_px, 7.5)
  assert.equal(raw[0]!.pressure, null)
})
test('same CSS gesture preserves capture widths at every zoom and DPR', () => {
  const b = defaultBrush(),
    raw = points(0.3),
    baseline = deriveWidth(raw, b)
  for (const scale of [0.5, 1, 2])
    for (const dpr of [1, 2]) {
      const profile = clone(b)
      profile.capture_viewport.scale = scale
      profile.capture_viewport.device_pixel_ratio = dpr
      const ws = deriveWidth(raw, profile)
      ws.forEach((w, i) =>
        assert.ok(Math.abs(w.width_image_px * scale - baseline[i]!.width_image_px) < 1e-8),
      )
    }
})
test('invalid brush settings are rejected and fixed mode remains uniform', () => {
  const b = defaultBrush()
  b.mode = 'fixed'
  assert.equal(new Set(deriveWidth(points(0.8), b).map((p) => p.width_image_px)).size, 1)
  b.w_min_css_px = 20
  assert.throws(() => deriveWidth(points(), b))
})
test('editing and reversal preserve original samples and carry width values', () => {
  const { s } = fixture(),
    original = JSON.stringify(s.raw_points)
  prepareEdit(s, 2)
  assert.ok(s.edited_points!.length < s.raw_points.length)
  const w = widths(s).slice()
  s.edited_points!.reverse()
  s.edited_widths!.reverse()
  s.reversed = !s.reversed
  assert.deepEqual(widths(s), w.reverse())
  assert.equal(JSON.stringify(s.raw_points), original)
  s.edited_points![0]!.x += 5
  assert.equal(JSON.stringify(s.raw_points), original)
})
test('arc-length interpolation and section endpoints are geometric', () => {
  const pts = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
  ]
  assert.deepEqual(pointAt(pts, 0.75), { x: 100, y: 50 })
  const section = arcSection(pts, 0.25, 0.75)
  assert.deepEqual(section, [
    { x: 50, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 50 },
  ])
})
test('immutable revision binds annotation to its own route id', () => {
  const { t, img } = fixture()
  t.annotation.original_intent_text = 'old'
  t.annotation.intent_units.push({
    id: uid(),
    stroke_id: t.strokes[0]!.stroke_id,
    route_revision_id: 'previous-route',
    s_start: 0,
    s_end: 1,
    relation: 'insufficient_information',
    object_refs: [],
    movements: [],
    gaze: 'unspecified',
    source: 'unspecified',
    ambiguity: '',
    translation_constraints: {
      height: null,
      distance: null,
      side: 'unspecified',
      unit: 'relative',
      source: 'unspecified',
    },
    timing: { duration_seconds: null, source: 'unspecified' },
    ending: '',
    stale: false,
  })
  recordRevision(t, img)
  const r = t.revisions[0]!
  t.strokes[0]!.reversed = true
  t.annotation.original_intent_text = 'new'
  assert.equal(r.annotation.original_intent_text, 'old')
  assert.equal(r.strokes[0]!.reversed, false)
  assert.equal(r.id, t.route_revision_id)
  assert.equal(r.annotation.intent_units[0]!.route_revision_id, r.id)
})
test('model inputs use a strict allowlist and remove private intent/labels/name', () => {
  const { t, img } = fixture()
  t.annotation.original_intent_text = 'SECRET_INTENT'
  t.annotation.task_instruction = 'SECRET_INSTRUCTION'
  t.annotation.participant_id = 'SECRET_PARTICIPANT'
  img.objects.push({
    id: uid(),
    label: 'SECRET_OBJECT',
    category: 'target',
    geometry: 'box',
    points: [
      { x: 1, y: 2 },
      { x: 5, y: 8 },
    ],
    revision_id: uid(),
  })
  const text = JSON.stringify(inputOnly(t, img))
  assert.ok(!text.includes('SECRET_'))
  assert.ok(text.includes('width_image_px'))
  assert.ok(!text.includes('raw_points'))
  assert.ok(!text.includes('annotation'))
})
test('same scene family and same hash cannot cross splits', () => {
  const { p, img } = fixture(),
    other = clone(img)
  other.id = uid()
  other.split = 'test'
  p.images.push(other)
  assert.throws(() => validateProject(p), /场景族/)
  other.scene_family_id = uid()
  assert.throws(() => validateProject(p), /哈希/)
  other.sha256 = 'c'.repeat(64)
  assert.doesNotThrow(() => validateProject(p))
})
test('ranges, object references, out-of-bounds geometry and composition cycles are rejected', () => {
  const { p, t, img, s } = fixture()
  const unit = {
    id: uid(),
    stroke_id: s.stroke_id,
    route_revision_id: t.route_revision_id,
    s_start: 0,
    s_end: 0.6,
    relation: 'insufficient_information',
    object_refs: [],
    movements: [],
    gaze: 'unspecified',
    source: 'unspecified',
    ambiguity: '',
    translation_constraints: {
      height: null,
      distance: null,
      side: 'unspecified',
      unit: 'relative' as const,
      source: 'unspecified',
    },
    timing: { duration_seconds: null, source: 'unspecified' },
    ending: '',
    stale: false,
  }
  const other = { ...clone(unit), id: uid(), s_start: 0.5, s_end: 1 }
  assert.throws(() => validateUnits([unit, other], t, img), /重叠/)
  other.s_start = 0.6
  t.annotation.intent_units = [unit, other]
  t.annotation.composition = [
    { from: unit.id, to: other.id, relation: 'before' },
    { from: other.id, to: unit.id, relation: 'before' },
  ]
  assert.throws(() => validateProject(p), /循环/)
  t.annotation.composition = []
  s.raw_points[0]!.x = -1
  assert.throws(() => validateProject(p), /越界/)
})
test('frozen copies remain unchanged after later task edits', () => {
  const { p, t } = fixture()
  const snapshot = clone({ images: p.images, tasks: p.tasks })
  const old = JSON.stringify(snapshot)
  t.strokes[0]!.raw_points[0]!.x = 500
  t.annotation.original_intent_text = 'changed'
  assert.equal(JSON.stringify(snapshot), old)
})
test('SVG export uses actual variable geometry, original viewBox and clipping', async () => {
  const { t, img } = fixture(),
    s = t.strokes[0]!
  s.width_profile[0]!.width_image_px = 3
  s.width_profile[1]!.width_image_px = 12
  const svg = await routeSVG(t, img).text()
  assert.ok(svg.includes('viewBox="0 0 1600 900"'))
  assert.ok(svg.includes('r="1.5"'))
  assert.ok(svg.includes('r="6"'))
  assert.ok(svg.includes('clip-path'))
  assert.ok(!svg.includes('stroke-width'))
})
test('straight renderer calibration: drawn full width equals target', () => {
  const { s } = fixture()
  s.raw_points = [...points(0.3).slice(0, 3)]
  s.width_profile = s.raw_points.map((_, i) => ({
    source_index: i,
    speed_raw_css_px_ms: null,
    speed_filtered_css_px_ms: null,
    width_image_px: 12,
    initialization: i === 0,
    gap: false,
  }))
  const radii: number[] = []
  const ctx = {
    fillStyle: '',
    save() {},
    restore() {},
    beginPath() {},
    moveTo() {},
    lineTo() {},
    closePath() {},
    fill() {},
    arc(_x: number, _y: number, r: number) {
      radii.push(r)
    },
  }
  renderStroke(ctx as unknown as CanvasRenderingContext2D, s)
  assert.ok(radii.every((r) => r * 2 === 12))
})
test('ZIP Unicode paths, binary content and ordered route data round-trip', async () => {
  const { p } = fixture(),
    blob = await makeZip({
      'dataset/manifest.json': '{"schema_version":"1.1"}',
      'dataset/中文.json': JSON.stringify(p),
      'dataset/image.bin': new Blob([new Uint8Array([0, 1, 2, 255])]),
    })
  const files = await readZip(blob)
  assert.deepEqual(JSON.parse(await files.get('dataset/中文.json')!.text()), p)
  assert.deepEqual(
    new Uint8Array(await files.get('dataset/image.bin')!.arrayBuffer()),
    new Uint8Array([0, 1, 2, 255]),
  )
  assert.equal(files.size, 3)
})
test('ZIP corruption, path traversal and inflated size declarations are rejected', async () => {
  await assert.rejects(() => readZip(new Blob(['not zip'])), /无效/)
  await assert.rejects(() => makeZip({ '../escape': 'bad' }).then(readZip), /路径/)
  const bytes = new Uint8Array(await (await makeZip({ x: 'hello' })).arrayBuffer())
  bytes[31] = bytes[31]! ^ 1
  await assert.rejects(() => readZip(new Blob([bytes])), /校验/)
  const good = new Uint8Array(await (await makeZip({ x: 'hi' })).arrayBuffer()),
    v = new DataView(good.buffer)
  for (let i = 0; i < good.length - 46; i++)
    if (v.getUint32(i, true) === 0x02014b50) {
      v.setUint32(i + 24, 300 * 1024 * 1024, true)
      break
    }
  await assert.rejects(() => readZip(new Blob([good])), /上限/)
})
test('ZIP DEFLATE import is supported with bounded output and CRC', async () => {
  const raw = new TextEncoder().encode('hello '.repeat(80)),
    packed = deflateRawSync(raw),
    name = new TextEncoder().encode('x.txt'),
    local = new Uint8Array(30 + name.length),
    v = new DataView(local.buffer)
  v.setUint32(0, 0x04034b50, true)
  v.setUint16(4, 20, true)
  v.setUint16(8, 8, true)
  v.setUint32(14, crc32(raw), true)
  v.setUint32(18, packed.length, true)
  v.setUint32(22, raw.length, true)
  v.setUint16(26, name.length, true)
  local.set(name, 30)
  const dir = new Uint8Array(46 + name.length),
    d = new DataView(dir.buffer)
  d.setUint32(0, 0x02014b50, true)
  d.setUint16(10, 8, true)
  d.setUint32(16, crc32(raw), true)
  d.setUint32(20, packed.length, true)
  d.setUint32(24, raw.length, true)
  d.setUint16(28, name.length, true)
  dir.set(name, 46)
  const end = new Uint8Array(22),
    e = new DataView(end.buffer)
  e.setUint32(0, 0x06054b50, true)
  e.setUint16(8, 1, true)
  e.setUint16(10, 1, true)
  e.setUint32(12, dir.length, true)
  e.setUint32(16, local.length + packed.length, true)
  const zip = new Blob([local, packed, dir, end])
  const files = await readZip(zip)
  assert.equal(await files.get('x.txt')!.text(), 'hello '.repeat(80))
})
test('cancelled strokes are excluded from model payload and flagged by quality checks', () => {
  const { t, img, s } = fixture()
  s.cancelled = true
  assert.equal(inputOnly(t, img).strokes.length, 0)
  assert.ok(taskIssues(t).some((s) => s.includes('未完成')))
})
