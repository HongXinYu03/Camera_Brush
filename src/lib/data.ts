import type { ImageAsset, Project, Task, Stroke, IntentUnit } from './types.ts'
import { uid, now, newTask, clone, defaultBrush, emptyAnnotation } from './types.ts'
import { geometry, widths, renderStroke, validateBrush } from './geometry.ts'
import { sha256, getData, putData } from './storage.ts'
import { makeZip, readZip } from './zip.ts'
export const MAX_PIXELS = 32 * 1024 * 1024
export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob),
    a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 10000)
}
export function canvasBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('图像编码失败。'))), 'image/png'),
  )
}
export async function normalizeImage(
  file: Blob,
  name: string,
): Promise<{ asset: ImageAsset; image: Blob; source: Blob }> {
  if (file.size > 40 * 1024 * 1024) throw new Error(`${name} 超过 40 MB 上限。`)
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) throw new Error('仅支持 PNG、JPEG、WebP 图片。')
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  if (bitmap.width * bitmap.height > MAX_PIXELS || Math.max(bitmap.width, bitmap.height) > 16384) {
    bitmap.close()
    throw new Error('图片超过 3200 万像素或单边 16384 像素上限。')
  }
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0)
  bitmap.close()
  const image = await canvasBlob(canvas),
    id = uid()
  const asset: ImageAsset = {
    id,
    original_name: name,
    width: canvas.width,
    height: canvas.height,
    original_width: canvas.width,
    original_height: canvas.height,
    sha256: await sha256(image),
    source_sha256: await sha256(file),
    source_type: 'uploaded',
    scene: '未分类',
    style: '未指定',
    perspective: '未指定',
    difficulty: '未指定',
    scene_family_id: uid(),
    split: 'unassigned',
    license: '',
    generator: null,
    generator_version: null,
    prompt: null,
    seed: null,
    created_at: now(),
    objects: [],
    object_revisions: [],
  }
  return { asset, image, source: file }
}
export function inputOnly(task: Task, image: ImageAsset) {
  // Deliberate server-ready allowlist: never spread a Task/ImageAsset here.
  return {
    schema_version: '1.1',
    task_id: task.id,
    image_id: image.id,
    route_revision_id: task.route_revision_id,
    coordinate_frame: {
      origin: 'top_left',
      x: 'right',
      y: 'down',
      width: image.width,
      height: image.height,
    },
    active_geometry: 'current',
    strokes: task.strokes
      .filter((s) => !s.cancelled)
      .map((s) => ({
        stroke_id: s.stroke_id,
        order: s.order,
        centerline: geometry(s).map((p) => ({ x: p.x, y: p.y })),
        width_image_px: widths(s),
        width_semantics: s.brush_profile.width_semantics,
        color: s.brush_profile.color,
        renderer: s.brush_profile.renderer,
        renderer_version: s.brush_profile.renderer_version,
      })),
    input_policy: 'image_route_only',
    width_profile_included: true,
  }
}
export function taskIssues(task: Task): string[] {
  const issues: string[] = []
  if (!task.strokes.some((s) => !s.cancelled && s.raw_points.length > 1))
    issues.push('缺少有效路线')
  if (!task.annotation.original_intent_text.trim())
    issues.push(
      task.annotation.missing_intent ? '已标记缺失意图，不计入完整样本' : '尚未填写独立意图',
    )
  if (task.strokes.some((s) => s.cancelled)) issues.push('含未完成笔划，请恢复或删除')
  if (task.strokes.length > 1 && task.multi_stroke_relation === 'unspecified')
    issues.push('多笔语义关系未指定')
  if (task.annotation.intent_units.some((u) => u.stale)) issues.push('分段在改线后需要重新确认')
  if (task.strokes.some((s) => !s.width_transfer_confirmed)) issues.push('宽度迁移待确认')
  if (
    task.strokes.some((s) => s.brush_profile.width_semantics === 'timing_control') &&
    !task.annotation.timing_confirmed
  )
    issues.push('节奏控制协议尚未确认')
  for (const s of task.strokes.filter((s) => !s.cancelled)) {
    const units = task.annotation.intent_units
      .filter((u) => u.stroke_id === s.stroke_id)
      .sort((a, b) => a.s_start - b.s_start)
    if (
      units.length &&
      (units[0]!.s_start > 0.001 ||
        units.at(-1)!.s_end < 0.999 ||
        units.some((u, i) => i > 0 && Math.abs(u.s_start - units[i - 1]!.s_end) > 0.001))
    )
      issues.push('分段未形成无重叠的完整覆盖')
  }
  return [...new Set(issues)]
}
export function validateUnits(units: IntentUnit[], task: Task, image: ImageAsset) {
  for (const u of units) {
    if (
      !Number.isFinite(u.s_start) ||
      !Number.isFinite(u.s_end) ||
      u.s_start < 0 ||
      u.s_end > 1 ||
      u.s_start >= u.s_end
    )
      throw new Error('分段区间无效。')
    if (!task.strokes.some((s) => s.stroke_id === u.stroke_id))
      throw new Error('分段引用不存在的路线。')
    if (u.object_refs.some((id) => !image.objects.some((o) => o.id === id)))
      throw new Error('分段对象引用不完整。')
    if (
      units.some(
        (v) =>
          v.id !== u.id &&
          v.stroke_id === u.stroke_id &&
          Math.max(u.s_start, v.s_start) < Math.min(u.s_end, v.s_end) - 0.00001,
      )
    )
      throw new Error('同一路线的分段不能重叠。')
  }
}
export function validateProject(p: Project) {
  if (
    !p ||
    !Array.isArray(p.images) ||
    !Array.isArray(p.tasks) ||
    !Array.isArray(p.snapshots) ||
    !Array.isArray(p.runs)
  )
    throw new Error('项目结构不完整。')
  const ids = new Set<string>()
  for (const item of [...p.images, ...p.tasks]) {
    if (!item.id || ids.has(item.id)) throw new Error('实体 ID 重复。')
    ids.add(item.id)
  }
  const familySplit = new Map<string, string>(),
    hashSplit = new Map<string, string>()
  for (const image of p.images) {
    if (
      !Number.isFinite(image.width) ||
      !Number.isFinite(image.height) ||
      image.width <= 0 ||
      image.height <= 0 ||
      image.width * image.height > MAX_PIXELS
    )
      throw new Error('图像尺寸无效。')
    if (!['unassigned', 'train', 'dev', 'test', 'external_test'].includes(image.split))
      throw new Error('未知的数据划分。')
    if (
      familySplit.has(image.scene_family_id) &&
      familySplit.get(image.scene_family_id) !== image.split
    )
      throw new Error('同一场景族不能跨数据划分。')
    if (hashSplit.has(image.sha256) && hashSplit.get(image.sha256) !== image.split)
      throw new Error('相同哈希的图片不能跨数据划分。')
    familySplit.set(image.scene_family_id, image.split)
    hashSplit.set(image.sha256, image.split)
    for (const o of image.objects)
      if (
        o.points.some(
          (pt) =>
            !Number.isFinite(pt.x) ||
            !Number.isFinite(pt.y) ||
            pt.x < 0 ||
            pt.x > image.width ||
            pt.y < 0 ||
            pt.y > image.height,
        )
      )
        throw new Error('对象坐标越界。')
  }
  for (const task of p.tasks) {
    const image = p.images.find((i) => i.id === task.image_id)
    if (!image) throw new Error('任务的图像引用缺失。')
    for (const s of task.strokes) validateStroke(s, image)
    const strokeIds = task.strokes.map((s) => s.stroke_id)
    if (new Set(strokeIds).size !== strokeIds.length) throw new Error('任务内的路线 ID 重复。')
    validateUnits(task.annotation.intent_units, task, image)
    const nodes = task.annotation.intent_units.map((u) => u.id),
      edges = task.annotation.composition
    for (const edge of edges)
      if (edge.from === edge.to || !nodes.includes(edge.from) || !nodes.includes(edge.to))
        throw new Error('组合关系引用无效。')
    const visit = (node: string, stack: Set<string>): void => {
      if (stack.has(node)) throw new Error('先后关系存在循环。')
      const next = new Set(stack).add(node)
      edges
        .filter((e) => e.from === node && e.relation === 'before')
        .forEach((e) => visit(e.to, next))
    }
    nodes.forEach((n) => visit(n, new Set()))
    for (const revision of task.revisions) {
      if (
        revision.image_id !== image.id ||
        revision.image_sha256 !== image.sha256 ||
        revision.width !== image.width ||
        revision.height !== image.height
      )
        throw new Error('历史路线的图像版本引用不一致。')
      revision.strokes.forEach((s) => validateStroke(s, image))
    }
  }
  for (const snapshot of p.snapshots) {
    validateProject({
      ...p,
      images: snapshot.images,
      tasks: snapshot.tasks,
      snapshots: [],
      runs: [],
    })
  }
  for (const run of p.runs) {
    const snapshot = p.snapshots.find((s) => s.id === run.dataset_snapshot_id)
    if (
      !snapshot ||
      !snapshot.tasks.some(
        (t) => t.id === run.task_id && t.route_revision_id === run.route_revision_id,
      )
    )
      throw new Error('实验运行的冻结快照或路线引用缺失。')
  }
}
function validateStroke(s: Stroke, image: ImageAsset) {
  if (!validateBrush(s.brush_profile) || !Array.isArray(s.raw_points) || !s.raw_points.length)
    throw new Error('路线或笔刷参数无效。')
  const pts = [...s.raw_points, ...(s.edited_points || [])]
  if (pts.length > 200000) throw new Error('单条路线采样点超过 20 万上限。')
  if (
    pts.some(
      (p) =>
        !Number.isFinite(p.x) ||
        !Number.isFinite(p.y) ||
        p.x < 0 ||
        p.x > image.width ||
        p.y < 0 ||
        p.y > image.height,
    )
  )
    throw new Error('路线坐标越界。')
  if (
    s.width_profile.length !== s.raw_points.length ||
    s.width_profile.some(
      (w) =>
        !Number.isFinite(w.width_image_px) || w.width_image_px <= 0 || w.width_image_px > 16384,
    )
  )
    throw new Error('路线线宽数据无效。')
  if (
    s.edited_points &&
    (s.edited_widths?.length !== s.edited_points.length ||
      s.edited_widths.some((w) => !Number.isFinite(w) || w <= 0 || w > 16384))
  )
    throw new Error('编辑后宽度与中心线长度不一致，或线宽无效。')
  if (
    s.brush_profile.mode === 'velocity' &&
    s.raw_points.some(
      (p, i) => !Number.isFinite(p.t_ms) || (i > 0 && p.t_ms < s.raw_points[i - 1]!.t_ms),
    )
  )
    throw new Error('速度模式缺少有效的有序时间戳。')
}
export async function overlay(task: Task, asset: ImageAsset, transparent = false, helpers = true) {
  const canvas = document.createElement('canvas')
  canvas.width = asset.width
  canvas.height = asset.height
  const ctx = canvas.getContext('2d')!
  if (!transparent) {
    const blob = await getData<Blob>('assets', asset.id)
    if (!blob) throw new Error('底图文件缺失。')
    const bitmap = await createImageBitmap(blob)
    ctx.drawImage(bitmap, 0, 0)
    bitmap.close()
  }
  task.strokes.filter((s) => !s.cancelled).forEach((s) => renderStroke(ctx, s, { helpers }))
  return canvasBlob(canvas)
}
export function routeSVG(task: Task, image: ImageAsset) {
  let content = ''
  for (const s of task.strokes.filter((s) => !s.cancelled)) {
    const pts = geometry(s),
      ws = widths(s),
      color = /^#[0-9a-f]{6}$/i.test(s.brush_profile.color) ? s.brush_profile.color : '#ef534f'
    pts.forEach((p, i) => {
      if (i) {
        const a = pts[i - 1]!,
          len = Math.hypot(p.x - a.x, p.y - a.y) || 1,
          nx = -(p.y - a.y) / len,
          ny = (p.x - a.x) / len,
          r0 = ws[i - 1]! / 2,
          r1 = ws[i]! / 2
        content += `<polygon points="${a.x + nx * r0},${a.y + ny * r0} ${p.x + nx * r1},${p.y + ny * r1} ${p.x - nx * r1},${p.y - ny * r1} ${a.x - nx * r0},${a.y - ny * r0}" fill="${color}"/>`
      }
      content += `<circle cx="${p.x}" cy="${p.y}" r="${ws[i]! / 2}" fill="${color}"/>`
    })
  }
  return new Blob(
    [
      `<svg xmlns="http://www.w3.org/2000/svg" width="${image.width}" height="${image.height}" viewBox="0 0 ${image.width} ${image.height}"><defs><clipPath id="image"><rect width="${image.width}" height="${image.height}"/></clipPath></defs><g clip-path="url(#image)">${content}</g></svg>`,
    ],
    { type: 'image/svg+xml' },
  )
}
export async function exportProject(
  project: Project,
  mode: 'research_full' | 'model_inputs_only',
  helpers = true,
) {
  validateProject(project)
  const files: Record<string, Blob | string> = {},
    json = (v: unknown) => JSON.stringify(v, null, 2)
  const images = project.images.filter((i) => mode === 'research_full' || !i.deleted_at)
  const tasks = project.tasks.filter(
    (t) => mode === 'research_full' || images.some((i) => i.id === t.image_id),
  )
  for (const image of images) {
    const blob = await getData<Blob>('assets', image.id)
    if (!blob) throw new Error('本地底图缺失。')
    files[`dataset/images/${image.id}.png`] = blob
    if (mode === 'research_full') {
      const source = await getData<Blob>('assets', `source:${image.id}`)
      if (source) files[`dataset/source_images/${image.id}.bin`] = source
      files[`dataset/objects/${image.id}.json`] = json(image.objects)
    }
  }
  for (const task of tasks) {
    const image = project.images.find((i) => i.id === task.image_id)!
    files[`dataset/tasks/${task.id}/input.json`] = json(inputOnly(task, image))
    files[`dataset/tasks/${task.id}/overlay.png`] = await overlay(task, image, false, helpers)
    if (mode === 'research_full')
      files[`dataset/tasks/${task.id}/annotation.json`] = json(task.annotation)
  }
  if (mode === 'research_full') {
    files['dataset/project.json'] = json(project)
    project.snapshots.forEach((s) => {
      files[`dataset/splits/${s.id}.json`] = json(s)
    })
    project.runs.forEach((r) => {
      files[`dataset/runs/${r.id}.json`] = json(r)
    })
  }
  const checksums: string[] = []
  for (const [path, value] of Object.entries(files))
    checksums.push(`${await sha256(value)}  ${path}`)
  files['dataset/checksums.sha256'] = checksums.join('\n')
  files['dataset/manifest.json'] = json({
    schema_version: '1.1',
    application_version: '0.1.0-frontend',
    vocabulary_version: '1.0',
    export_mode: mode,
    coordinate_frame: 'standard_orientation_image_top_left_xy',
    input_policy: 'image_route_only',
    width_profile_included: true,
    render_options: { show_end_arrow: helpers, show_start_marker: helpers, show_numbers: false },
    files: Object.keys(files),
    statistics: { images: images.length, tasks: tasks.length },
  })
  return makeZip(files)
}
export async function importProject(file: Blob): Promise<Project> {
  const files = await readZip(file),
    manifestBlob = files.get('dataset/manifest.json')
  if (!manifestBlob) throw new Error('未找到 dataset/manifest.json。')
  const manifest = JSON.parse(await manifestBlob.text())
  if (!['1.0', '1.1'].includes(manifest.schema_version))
    throw new Error('不支持的数据协议版本，请勿将未来版本当作旧版解释。')
  if (manifest.export_mode !== 'research_full')
    throw new Error('仅模型输入包不包含研究数据，无法恢复为完整项目。')
  const sums = files.get('dataset/checksums.sha256')
  if (!sums) throw new Error('缺少校验和清单。')
  const verified = new Set<string>()
  for (const line of (await sums.text()).split('\n').filter(Boolean)) {
    const match = /^([a-f0-9]{64})  (.+)$/.exec(line)
    if (!match || !files.has(match[2]!) || (await sha256(files.get(match[2]!)!)) !== match[1])
      throw new Error('SHA-256 文件校验失败。')
    verified.add(match[2]!)
  }
  for (const path of files.keys())
    if (
      !['dataset/manifest.json', 'dataset/checksums.sha256'].includes(path) &&
      !verified.has(path)
    )
      throw new Error('存在未经哈希校验的文件。')
  const source = files.get('dataset/project.json')
  if (!source) throw new Error('缺少完整项目数据。')
  const project = JSON.parse(await source.text()) as Project
  if (manifest.schema_version === '1.0') migrateLegacy(project)
  validateProject(project)
  for (const image of project.images) {
    const blob = files.get(`dataset/images/${image.id}.png`)
    if (!blob || (await sha256(blob)) !== image.sha256) throw new Error('图像哈希不一致。')
    const bitmap = await createImageBitmap(blob)
    const correct = bitmap.width === image.width && bitmap.height === image.height
    bitmap.close()
    if (!correct) throw new Error('图像尺寸不一致。')
    const existing = await getData<Blob>('assets', image.id)
    if (existing && (await sha256(existing)) !== image.sha256)
      throw new Error('导入图像的 ID 与现有不同内容冲突。已停止导入，未覆盖已有图像。')
    const original = files.get(`dataset/source_images/${image.id}.bin`)
    if (original && (await sha256(original)) !== image.source_sha256)
      throw new Error('原始图像文件的哈希不一致。')
    const existingSource = await getData<Blob>('assets', `source:${image.id}`)
    if (original && existingSource && (await sha256(existingSource)) !== image.source_sha256)
      throw new Error('原始文件 ID 冲突。导入已停止，不覆盖现有源文件。')
  }
  for (const snapshot of project.snapshots) {
    if (
      (await sha256(JSON.stringify({ images: snapshot.images, tasks: snapshot.tasks }))) !==
      snapshot.sha256
    )
      throw new Error('冻结快照的内容哈希不一致。')
  }
  // Imported project is always a new project; stable dataset entity IDs remain intact.
  project.id = uid()
  project.name += ' · 导入副本'
  project.version = 0
  project.updated_at = now()
  for (const image of project.images) {
    await putData('assets', image.id, files.get(`dataset/images/${image.id}.png`)!)
    const original = files.get(`dataset/source_images/${image.id}.bin`)
    if (original) await putData('assets', `source:${image.id}`, original)
  }
  return project
}
function migrateLegacy(project: Project) {
  project.snapshots ??= []
  project.runs ??= []
  project.brush ??= defaultBrush()
  project.images.forEach((i) => {
    i.objects ??= []
    i.object_revisions ??= []
  })
  project.tasks.forEach((t) => {
    t.annotation = { ...emptyAnnotation(), ...t.annotation }
    t.revisions ??= []
    t.route_revision_id ||= uid()
    t.strokes.forEach((s) => {
      if (!s.brush_profile) {
        s.brush_profile = { ...defaultBrush(), mode: 'fixed' }
        s.width_profile = s.raw_points.map((_, i) => ({
          source_index: i,
          speed_raw_css_px_ms: null,
          speed_filtered_css_px_ms: null,
          width_image_px: 5,
          initialization: i === 0,
          gap: false,
        }))
      }
      s.edited_widths ??= s.edited_points?.map(() => 5) ?? null
      s.width_transfer_confirmed ??= true
      s.cancelled ??= false
    })
  })
}
export function recordRevision(task: Task, image: ImageAsset) {
  const revisionId = uid()
  task.route_revision_id = revisionId
  task.annotation.annotation_revision_id = uid()
  task.annotation.intent_units.forEach((u) => {
    if (!u.stale) u.route_revision_id = revisionId
  })
  const revision = {
    id: revisionId,
    created_at: now(),
    image_id: image.id,
    image_sha256: image.sha256,
    width: image.width,
    height: image.height,
    strokes: clone(task.strokes),
    annotation: clone(task.annotation),
    status: task.status,
  }
  task.revisions.push(revision)
}
export function createTask(project: Project, imageId: string) {
  const task = newTask(imageId, project.tasks.length + 1)
  project.tasks.push(task)
  return task
}
