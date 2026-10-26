<script setup lang="ts">
import { computed, ref, onMounted, onBeforeUnmount } from 'vue'
import type { Project, Task, ImageAsset, Tool, Stroke, Point, Viewport } from '../lib/types'
import { clone, uid, now, statusLabels } from '../lib/types'
import { geometry, validateBrush } from '../lib/geometry'
import { recordRevision, overlay, routeSVG, download } from '../lib/data'
import { visibleTasks } from '../lib/images'
import Icon from './Icon.vue'
import RouteCanvas from './RouteCanvas.vue'
const props = defineProps<{
  project: Project
  task: Task
  asset: ImageAsset
  url: string
  saveState: string
}>()
const emit = defineEmits<{
  dirty: []
  save: []
  message: [text: string]
  previous: []
  next: []
  export: []
}>()
const canvas = ref<InstanceType<typeof RouteCanvas>>(),
  tool = ref<Tool>('draw'),
  selected = ref(props.task.strokes[0]?.stroke_id || '')
const brushSettings = ref(false),
  exportOpen = ref(false),
  helpers = ref(true)
const viewport = ref<Viewport>({
    scale: 0.5,
    translate_x: 0,
    translate_y: 0,
    device_pixel_ratio: 1,
  }),
  position = ref<Point>({ x: 0, y: 0 }),
  liveWidth = ref(7.5)
const selectedStroke = computed(() =>
  props.task.strokes.find((s) => s.stroke_id === selected.value),
)
const brush = computed(() => props.project.brush),
  count = computed(() => props.task.strokes.reduce((n, s) => n + geometry(s).length, 0))
const captureBrush = computed(() => ({ ...brush.value, width_semantics: 'visual_only' as const }))
const tools: { tool: Tool; icon: string; label: string; key: string }[] = [
  { tool: 'draw', icon: 'brush', label: '绘制', key: 'B' },
  { tool: 'select', icon: 'select', label: '选择', key: 'V' },
  { tool: 'edit', icon: 'edit', label: '顶点', key: 'E' },
  { tool: 'pan', icon: 'hand', label: '平移', key: 'H' },
]
interface UndoState {
  strokes: Stroke[]
  annotation: Task['annotation']
  revision: string
  status: Task['status']
}
const undoStack = ref<UndoState[]>([]),
  redoStack = ref<UndoState[]>([])
const snapshot = (): UndoState =>
  clone({
    strokes: props.task.strokes,
    annotation: props.task.annotation,
    revision: props.task.route_revision_id,
    status: props.task.status,
  })
function before() {
  undoStack.value.push(snapshot())
  if (undoStack.value.length > 35) undoStack.value.shift()
  redoStack.value = []
}
function restore(s: UndoState) {
  props.task.strokes = clone(s.strokes)
  props.task.annotation = clone(s.annotation)
  props.task.route_revision_id = s.revision
  props.task.status = s.status
  selected.value =
    props.task.strokes.find((s) => s.stroke_id === selected.value)?.stroke_id ||
    props.task.strokes[0]?.stroke_id ||
    ''
  emit('dirty')
  canvas.value?.refresh()
}
function undo() {
  const s = undoStack.value.pop()
  if (s) {
    redoStack.value.push(snapshot())
    restore(s)
  }
}
function redo() {
  const s = redoStack.value.pop()
  if (s) {
    undoStack.value.push(snapshot())
    restore(s)
  }
}
function change() {
  props.task.route_revision_id = uid()
  props.task.updated_at = now()
  props.task.modification_count++
  props.task.status = 'draft'
  props.task.annotation.confirmed = false
  props.task.annotation.intent_units.forEach((u) => (u.stale = true))
  emit('dirty')
}
function setTool(t: Tool) {
  canvas.value?.cancel()
  tool.value = t
  if (t === 'edit') canvas.value?.editSelected()
}
function selectStroke(id: string) {
  selected.value = id
  if (tool.value === 'edit') tool.value = 'select'
}
function reverse() {
  const s = selectedStroke.value
  if (!s) return
  before()
  if (s.active_geometry === 'edited' && s.edited_points) {
    s.edited_points.reverse()
    s.edited_widths?.reverse()
  }
  s.reversed = !s.reversed
  change()
}
function remove() {
  const id = selected.value
  if (!selectedStroke.value) return
  before()
  const removedUnits = new Set(
    props.task.annotation.intent_units.filter((u) => u.stroke_id === id).map((u) => u.id),
  )
  props.task.annotation.intent_units = props.task.annotation.intent_units.filter(
    (u) => u.stroke_id !== id,
  )
  props.task.annotation.composition = props.task.annotation.composition.filter(
    (e) => !removedUnits.has(e.from) && !removedUnits.has(e.to),
  )
  props.task.strokes = props.task.strokes.filter((s) => s.stroke_id !== id)
  selected.value = props.task.strokes[0]?.stroke_id || ''
  change()
}
function recover(s: Stroke) {
  before()
  s.cancelled = false
  selected.value = s.stroke_id
  change()
}
function save() {
  canvas.value?.cancel()
  recordRevision(props.task, props.asset)
  emit('dirty')
  emit('save')
}
function params() {
  const b = brush.value
  b.w_min_css_px = Math.max(0.5, Number(b.w_min_css_px) || 3)
  b.w_max_css_px = Math.max(b.w_min_css_px + 0.5, Math.min(100, Number(b.w_max_css_px) || 12))
  b.v_slow_css_px_ms = Math.max(0, Number(b.v_slow_css_px_ms) || 0)
  b.v_fast_css_px_ms = Math.max(b.v_slow_css_px_ms + 0.01, Number(b.v_fast_css_px_ms) || 1.5)
  b.gamma = Math.max(0.05, Number(b.gamma) || 1)
  b.tau_ms = Math.max(1, Number(b.tau_ms) || 30)
  if (validateBrush(b)) emit('dirty')
}
async function exportImage(kind: 'overlay' | 'transparent' | 'svg') {
  try {
    const blob =
      kind === 'svg'
        ? routeSVG(props.task, props.asset)
        : await overlay(props.task, props.asset, kind === 'transparent', helpers.value)
    download(blob, `${props.task.id}-${kind}.${kind === 'svg' ? 'svg' : 'png'}`)
    exportOpen.value = false
  } catch (e) {
    emit('message', (e as Error).message)
  }
}
function keyboard(e: KeyboardEvent) {
  if ((e.target as HTMLElement).matches('input,textarea,select,[contenteditable=true]')) return
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
    e.preventDefault()
    save()
    return
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
    e.preventDefault()
    e.shiftKey ? redo() : undo()
    return
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
    e.preventDefault()
    redo()
    return
  }
  if (e.key === 'Delete' || e.key === 'Backspace') {
    e.preventDefault()
    tool.value === 'edit' ? canvas.value?.removeVertex() : remove()
    return
  }
  if (e.ctrlKey || e.metaKey || e.altKey) return
  const t = tools.find((t) => t.key.toLowerCase() === e.key)
  if (t) setTool(t.tool)
}
onMounted(() => window.addEventListener('keydown', keyboard))
onBeforeUnmount(() => window.removeEventListener('keydown', keyboard))
</script>
<template>
  <section class="work-area">
    <div class="work-titlebar">
      <div class="work-title">
        <h1>{{ asset.original_name }}</h1>
        <span class="image-size mono">{{ asset.width }} × {{ asset.height }}</span>
      </div>
      <span class="badge">{{ statusLabels[task.status] }}</span>
    </div>
    <div class="work-toolbar">
      <div class="tool-group">
        <button
          v-for="item in tools"
          :key="item.tool"
          class="tool-button labeled"
          :class="{ active: tool === item.tool }"
          :title="`${item.label} (${item.key})`"
          :aria-label="item.label"
          @click="setTool(item.tool)"
        >
          <Icon :name="item.icon" :size="17" /><span>{{ item.label }}</span>
        </button>
      </div>
      <div class="tool-group">
        <button
          class="tool-button"
          title="撤销 Ctrl+Z"
          aria-label="撤销"
          :disabled="!undoStack.length"
          @click="undo"
        >
          <Icon name="undo" :size="18" /></button
        ><button
          class="tool-button"
          title="重做 Ctrl+Shift+Z"
          aria-label="重做"
          :disabled="!redoStack.length"
          @click="redo"
        >
          <Icon name="redo" :size="18" />
        </button>
      </div>
      <div class="tool-group">
        <button
          class="tool-button"
          title="反向路线"
          aria-label="反向路线"
          :disabled="!selectedStroke"
          @click="reverse"
        >
          <Icon name="reverse" :size="18" /></button
        ><button
          class="tool-button"
          title="删除选中路线"
          aria-label="删除路线"
          :disabled="!selectedStroke"
          @click="remove"
        >
          <Icon name="trash" :size="17" />
        </button>
      </div>
      <span class="toolbar-spacer" /><button class="button small" @click="save">
        <Icon name="save" :size="15" />保存
      </button>
      <div class="popover-wrap">
        <button class="button small" @click="exportOpen = !exportOpen">
          <Icon name="download" :size="15" />导出<Icon name="down" :size="12" />
        </button>
        <div v-if="exportOpen" class="dropdown">
          <button @click="exportImage('overlay')">叠加图 PNG</button
          ><button @click="exportImage('transparent')">透明路线 PNG</button
          ><button @click="exportImage('svg')">路线 SVG</button
          ><button @click="emit('export')">完整 ZIP 备份</button>
        </div>
      </div>
    </div>
    <div class="studio-body">
      <div class="canvas-column">
        <div class="brush-bar">
          <Icon name="brush" :size="15" /><select
            v-model="brush.mode"
            :disabled="project.brush_locked"
            aria-label="笔刷模式"
            @change="emit('dirty')"
          >
            <option value="velocity">速度映射笔刷</option>
            <option value="fixed">固定宽度笔刷</option></select
          ><input
            v-model="brush.color"
            type="color"
            aria-label="路线颜色"
            :disabled="project.brush_locked"
            @change="emit('dirty')"
          /><span
            class="width-preview"
            :style="{ height: `${Math.min(liveWidth, 20)}px`, background: brush.color }"
          /><span class="mono tiny">{{ liveWidth.toFixed(1) }} px</span
          ><span class="toolbar-spacer" /><button
            class="text-button"
            :aria-expanded="brushSettings"
            @click="brushSettings = !brushSettings"
          >
            笔刷设置<Icon name="down" :size="12" />
          </button>
        </div>
        <div v-if="brushSettings" class="brush-settings">
          <div class="inline spread">
            <span class="muted tiny">设置仅影响下一笔</span
            ><button
              v-if="project.brush_locked"
              class="text-button"
              @click="
                ($event) => {
                  project.brush_locked = false
                  emit('dirty')
                }
              "
            >
              <Icon name="unlock" :size="13" />解锁旧采集参数
            </button>
          </div>
          <fieldset :disabled="project.brush_locked" class="brush-grid">
            <label
              >最细 / px<input
                v-model.number="brush.w_min_css_px"
                type="number"
                min=".5"
                step=".5"
                @change="params" /></label
            ><label
              >最粗 / px<input
                v-model.number="brush.w_max_css_px"
                type="number"
                min="1"
                max="100"
                step=".5"
                @change="params" /></label
            ><label
              >映射方向<select v-model="brush.direction" @change="emit('dirty')">
                <option value="slow_thick">慢画更粗</option>
                <option value="fast_thick">快画更粗</option>
              </select></label
            ><label
              >平滑 / ms<input v-model.number="brush.tau_ms" type="number" min="1" @change="params"
            /></label>
          </fieldset>
          <p class="muted tiny">笔触粗细只用于显示；绘制速度不代表相机运动速度。</p>
        </div>
        <RouteCanvas
          ref="canvas"
          :task="task"
          :asset="asset"
          :url="url"
          :brush="captureBrush"
          :tool="tool"
          :selected="selected"
          :raw="false"
          :helpers="helpers"
          :objects="false"
          :section="null"
          :playing="false"
          :playback="0"
          @before="before"
          @change="change"
          @select="selectStroke"
          @position="position = $event"
          @viewport="viewport = $event"
          @width="liveWidth = $event"
          @message="emit('message', $event)"
        />
        <div class="canvas-controls">
          <div class="inline">
            <button
              class="tool-button small-icon"
              aria-label="缩小"
              @click="canvas?.zoom(viewport.scale / 1.25)"
            >
              <Icon name="minus" :size="15" /></button
            ><button class="zoom-label mono" title="恢复 100%" @click="canvas?.zoom(1)">
              {{ Math.round(viewport.scale * 100) }}%</button
            ><button
              class="tool-button small-icon"
              aria-label="放大"
              @click="canvas?.zoom(viewport.scale * 1.25)"
            >
              <Icon name="plus" :size="15" /></button
            ><span class="divider" /><button class="text-button" @click="canvas?.fit()">
              <Icon name="fit" :size="14" />适应窗口
            </button>
          </div>
          <label class="check-row"><input v-model="helpers" type="checkbox" />起点与方向箭头</label>
        </div>
        <div class="studio-status">
          <span class="mono">X {{ position.x.toFixed(1) }} · Y {{ position.y.toFixed(1) }}</span
          ><span>{{ count.toLocaleString() }} 个点</span><span class="toolbar-spacer" /><span
            ><kbd>Space</kbd> 拖动平移 · 滚轮缩放</span
          >
        </div>
      </div>
      <aside class="inspector">
        <section class="inspector-section">
          <div class="section-label">
            <h2>路线图层</h2>
            <span class="count">{{ task.strokes.length }}</span>
          </div>
          <button
            v-for="(s, i) in task.strokes"
            :key="s.stroke_id"
            class="route-item"
            :class="{ selected: s.stroke_id === selected }"
            @click="selectStroke(s.stroke_id)"
          >
            <span class="route-line" :style="{ background: s.brush_profile.color }" />
            <div>
              <strong>笔划 {{ String(i + 1).padStart(2, '0') }}</strong
              ><small>{{ s.cancelled ? '未完成的笔划' : `${geometry(s).length} 个采样点` }}</small>
            </div>
            <span v-if="s.cancelled" class="recover-link" @click.stop="recover(s)">恢复</span
            ><Icon v-else-if="s.stroke_id === selected" name="check" :size="14" />
          </button>
          <p v-if="!task.strokes.length" class="empty-mini">在图片上按住鼠标拖动，画出第一笔。</p>
        </section>
        <section class="inspector-section">
          <label class="field-label"
            >路线名称<input
              v-model="task.name"
              aria-label="路线名称"
              @input="emit('dirty')" /></label
          ><label class="field-label"
            >运动意图 <span class="optional">选填</span
            ><textarea
              v-model="task.annotation.original_intent_text"
              rows="6"
              aria-label="原始意图"
              placeholder="这条路线想表达怎样的镜头运动？"
              @input="emit('dirty')"
            />
          </label>
          <p class="field-hint">用自己的话描述即可。路线与意图会自动保存在当前浏览器中。</p>
        </section>
        <div class="inspector-bottom">
          <div class="inline spread">
            <button
              class="tool-button"
              aria-label="上一个任务"
              title="上一个任务"
              @click="emit('previous')"
            >
              <Icon name="chevron" :size="15" class="rotate-180" /></button
            ><span class="muted tiny"
              >{{ visibleTasks(project).findIndex((t) => t.id === task.id) + 1 }} /
              {{ visibleTasks(project).length }}</span
            ><button
              class="tool-button"
              aria-label="下一个任务"
              title="下一个任务"
              @click="emit('next')"
            >
              <Icon name="chevron" :size="15" />
            </button>
          </div>
          <button class="button primary full" @click="save">
            <Icon name="save" :size="16" />保存路线
          </button>
          <p class="tiny muted">{{ saveState }}</p>
        </div>
      </aside>
    </div>
  </section>
</template>
