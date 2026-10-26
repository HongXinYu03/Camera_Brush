export type Tool = 'draw' | 'select' | 'edit' | 'pan' | 'box' | 'polygon'
export type Status = 'draft' | 'submitted' | 'annotated' | 'reviewed' | 'excluded'
export type Split = 'unassigned' | 'train' | 'dev' | 'test' | 'external_test'
export interface Point {
  x: number
  y: number
}
export interface Viewport {
  scale: number
  translate_x: number
  translate_y: number
  device_pixel_ratio: number
}
export interface RawPoint extends Point {
  t_ms: number
  capture_css_x: number
  capture_css_y: number
  pressure: number | null
  event_pressure_raw: number | null
  pressure_source: 'pen' | 'unavailable'
  sample_index: number
}
export interface WidthPoint {
  source_index: number
  speed_raw_css_px_ms: number | null
  speed_filtered_css_px_ms: number | null
  width_image_px: number
  initialization: boolean
  gap: boolean
}
export interface BrushProfile {
  mode: 'velocity' | 'fixed'
  direction: 'slow_thick' | 'fast_thick'
  width_semantics: 'visual_only' | 'timing_control'
  speed_space: 'capture_css_px_per_ms'
  width_unit: 'image_px_diameter'
  w_min_css_px: number
  w_max_css_px: number
  v_slow_css_px_ms: number
  v_fast_css_px_ms: number
  gamma: number
  tau_ms: number
  gap_reset_ms: number
  capture_viewport: Viewport
  algorithm_version: string
  renderer: string
  renderer_version: string
  render_options: { taper: false; streamline: 0 }
  color: string
}
export interface Stroke {
  stroke_id: string
  order: number
  pointer_type: string
  pressure_available: boolean
  raw_points: RawPoint[]
  edited_points: Point[] | null
  processed_points: Point[] | null
  active_geometry: 'raw' | 'edited'
  reversed: boolean
  brush_profile: BrushProfile
  width_profile: WidthPoint[]
  edited_widths: number[] | null
  cancelled: boolean
  width_transfer_policy: string
  width_transfer_confirmed: boolean
  simplification?: { method: string; tolerance_image_px: number }
}
export interface IntentUnit {
  id: string
  stroke_id: string
  route_revision_id: string
  s_start: number
  s_end: number
  relation: string
  object_refs: string[]
  movements: string[]
  gaze: string
  source: string
  ambiguity: string
  translation_constraints: {
    height: number | null
    distance: number | null
    side: string
    unit: 'relative'
    source: string
  }
  timing: { duration_seconds: number | null; source: string }
  ending: string
  stale: boolean
}
export interface ObjectAnnotation {
  id: string
  label: string
  category: string
  geometry: 'box' | 'polygon'
  points: Point[]
  revision_id: string
}
export interface Annotation {
  annotation_revision_id: string
  annotator_id: string
  original_intent_text: string
  missing_intent: boolean
  confirmed: boolean
  participant_id: string
  session_id: string
  collection_mode: 'free' | 'assigned'
  task_instruction: string
  intent_units: IntentUnit[]
  evidence_sufficiency: 'unspecified' | 'sufficient' | 'insufficient'
  acceptable_interpretations: string
  ambiguity: string
  exclusion_reason: string
  notes: string
  composition: { from: string; to: string; relation: 'before' | 'simultaneous' }[]
  practiced: boolean
  timing_confirmed: boolean
  camera_timing_intent: string
}
export interface RouteRevision {
  id: string
  created_at: string
  image_id: string
  image_sha256: string
  width: number
  height: number
  strokes: Stroke[]
  annotation: Annotation
  status: Status
}
export interface Task {
  id: string
  image_id: string
  name: string
  created_at: string
  updated_at: string
  status: Status
  strokes: Stroke[]
  annotation: Annotation
  revisions: RouteRevision[]
  route_revision_id: string
  multi_stroke_relation: 'unspecified' | 'confirmed'
  modification_count: number
  active_drawing_ms: number
  started_at: string
  submitted_at: string | null
  task_order: number
}
export interface ImageAsset {
  deleted_at?: string
  id: string
  original_name: string
  width: number
  height: number
  original_width: number
  original_height: number
  sha256: string
  source_sha256: string
  source_type: string
  scene: string
  style: string
  perspective: string
  difficulty: string
  scene_family_id: string
  split: Split
  license: string
  generator: string | null
  generator_version: string | null
  prompt: string | null
  seed: number | null
  created_at: string
  objects: ObjectAnnotation[]
  object_revisions: { id: string; created_at: string; objects: ObjectAnnotation[] }[]
}
export interface Snapshot {
  id: string
  name: string
  created_at: string
  sha256: string
  images: ImageAsset[]
  tasks: Task[]
}
export interface Run {
  id: string
  task_id: string
  route_revision_id: string
  dataset_snapshot_id: string
  method_id: string
  adapter: 'deterministic_mock' | 'external_json'
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'
  attempt: number
  parent_run_id: string | null
  created_at: string
  completed_at: string | null
  seed: number
  input_policy: 'image_route_only'
  input: unknown
  output: unknown
  error: string | null
  latency_ms: number | null
  cost: number | null
  evaluations: Evaluation[]
  corrections: { id: string; created_at: string; output: unknown; elapsed_ms: number }[]
}
export interface Evaluation {
  id: string
  evaluator_id: string
  preference: string
  reason: string
  created_at: string
  seed: number
  a_id: string
  b_id: string
}
export interface Project {
  id: string
  name: string
  description: string
  created_at: string
  updated_at: string
  version: number
  images: ImageAsset[]
  tasks: Task[]
  brush: BrushProfile
  brush_locked: boolean
  snapshots: Snapshot[]
  runs: Run[]
}
export const uid = () => crypto.randomUUID()
export const now = () => new Date().toISOString()
export const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T
export const defaultBrush = (): BrushProfile => ({
  mode: 'velocity',
  direction: 'slow_thick',
  width_semantics: 'visual_only',
  speed_space: 'capture_css_px_per_ms',
  width_unit: 'image_px_diameter',
  w_min_css_px: 3,
  w_max_css_px: 12,
  v_slow_css_px_ms: 0.05,
  v_fast_css_px_ms: 1.5,
  gamma: 1,
  tau_ms: 30,
  gap_reset_ms: 150,
  capture_viewport: { scale: 1, translate_x: 0, translate_y: 0, device_pixel_ratio: 1 },
  algorithm_version: 'velocity-width-v1',
  renderer: 'variable-capsule',
  renderer_version: '1.0.0',
  render_options: { taper: false, streamline: 0 },
  color: '#ef534f',
})
export const emptyAnnotation = (): Annotation => ({
  annotation_revision_id: uid(),
  annotator_id: 'researcher-01',
  original_intent_text: '',
  missing_intent: false,
  confirmed: false,
  participant_id: '',
  session_id: uid(),
  collection_mode: 'free',
  task_instruction: '',
  intent_units: [],
  evidence_sufficiency: 'unspecified',
  acceptable_interpretations: '',
  ambiguity: '',
  exclusion_reason: '',
  notes: '',
  composition: [],
  practiced: false,
  timing_confirmed: false,
  camera_timing_intent: '',
})
export const newProject = (name: string, description = ''): Project => ({
  id: uid(),
  name,
  description,
  created_at: now(),
  updated_at: now(),
  version: 0,
  images: [],
  tasks: [],
  brush: defaultBrush(),
  brush_locked: false,
  snapshots: [],
  runs: [],
})
export const newTask = (image_id: string, index: number): Task => ({
  id: uid(),
  image_id,
  name: `路线任务 ${String(index).padStart(2, '0')}`,
  created_at: now(),
  updated_at: now(),
  status: 'draft',
  strokes: [],
  annotation: emptyAnnotation(),
  revisions: [],
  route_revision_id: uid(),
  multi_stroke_relation: 'unspecified',
  modification_count: 0,
  active_drawing_ms: 0,
  started_at: now(),
  submitted_at: null,
  task_order: index,
})
export const statusLabels: Record<Status, string> = {
  draft: '草稿',
  submitted: '已提交',
  annotated: '已标注',
  reviewed: '已审核',
  excluded: '已排除',
}
export const splitLabels: Record<Split, string> = {
  unassigned: '未划分',
  train: '训练集',
  dev: '开发集',
  test: '测试集',
  external_test: '外部测试',
}
export const relations: Record<string, string> = {
  along_channel: '沿通道移动',
  pass_by: '从旁经过',
  weave_between: '在对象间穿梭',
  pass_through: '穿过开口',
  approach_stop: '接近并停留',
  orbit_subject: '围绕主体',
  reveal_behind: '揭示后方',
  ascend_reveal: '上升揭示',
  other: '其他',
  insufficient_information: '信息不足',
}
