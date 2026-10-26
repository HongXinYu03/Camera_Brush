<script setup lang="ts">
import { useApp } from './composables/useApp'
import { statusLabels } from './lib/types'
import Icon from './components/Icon.vue'
import Workspace from './components/Workspace.vue'
import DeleteImageDialog from './components/DeleteImageDialog.vue'
const {
  projects,
  currentId,
  selectedTask,
  ready,
  error,
  toast,
  busy,
  state,
  uploadInput,
  zipInput,
  showHelp,
  conflict,
  search,
  project,
  task,
  asset,
  urls,
  url,
  tasks,
  activeTasks,
  trash,
  pendingDelete,
  deleting,
  deletionImage,
  deletionCount,
  requestDelete,
  confirmDelete,
  restoreLastImage,
  message,
  dirty,
  persist,
  changeProject,
  openTask,
  adjacent,
  newTaskFor,
  handleUpload,
  handleImport,
  backup,
  reloadConflict,
  copyConflict,
} = useApp()
const reload = () => window.location.reload()
</script>
<template>
  <div v-if="!ready || error" class="boot-screen">
    <span class="brand-mark"><Icon name="route" :size="24" /></span>
    <h2>Camera Brush</h2>
    <p>{{ error || '正在打开路线工作台…' }}</p>
    <button v-if="error" class="button" @click="reload">重试</button>
  </div>
  <div v-else-if="project" class="app-shell">
    <header class="app-header">
      <div class="brand">
        <span class="brand-mark"><Icon name="route" :size="22" /></span><strong>Camera Brush</strong
        ><span class="header-separator" /><span class="header-title">路线工作台</span>
      </div>
      <div class="header-actions">
        <span class="save-status"><Icon name="check" :size="14" />{{ state }}</span
        ><button class="button" @click="zipInput?.click()">
          <Icon name="upload" :size="15" />导入备份</button
        ><button class="button" @click="backup"><Icon name="download" :size="15" />导出备份</button
        ><button class="icon-link" aria-label="使用帮助" title="使用帮助" @click="showHelp = true">
          <Icon name="help" :size="19" />
        </button>
      </div>
    </header>
    <div v-if="conflict" class="conflict-banner">
      <Icon name="alert" :size="17" /><span>其他标签页已更新此工作区，本地修改已保留。</span
      ><button class="button small" @click="copyConflict">另存副本</button
      ><button class="text-button" @click="reloadConflict">加载已保存版本</button>
    </div>
    <div class="app-body">
      <aside class="sidebar">
        <div class="sidebar-heading">
          <h2>图片与路线</h2>
          <span class="count">{{ activeTasks.length }}</span>
        </div>
        <select
          v-if="projects.length > 1"
          :value="currentId"
          aria-label="切换已有工作区"
          class="project-picker"
          @change="changeProject"
        >
          <option v-for="p in projects" :key="p.id" :value="p.id">{{ p.name }}</option></select
        ><button class="button primary full" @click="uploadInput?.click()">
          <Icon name="plus" :size="17" />导入场景图片
        </button>
        <div v-if="activeTasks.length" class="search-field">
          <Icon name="search" :size="15" /><input
            v-model="search"
            placeholder="查找图片或路线"
            aria-label="查找图片或路线"
          />
        </div>
        <div class="sidebar-task-list">
          <div
            v-for="t in tasks"
            :key="t.id"
            class="sidebar-task"
            :class="{ active: t.id === selectedTask }"
          >
            <button
              class="sidebar-task-open"
              :aria-current="t.id === selectedTask ? 'true' : undefined"
              @click="openTask(t.id)"
            >
              <img v-if="urls[t.image_id]" :src="urls[t.image_id]" alt="" />
              <div>
                <strong>{{ t.name }}</strong
                ><small>{{ project.images.find((i) => i.id === t.image_id)?.original_name }}</small
                ><span class="task-state">{{ statusLabels[t.status] }}</span>
              </div>
            </button>
            <button
              class="icon-link delete-image-button"
              :aria-label="`删除图片 ${project.images.find((i) => i.id === t.image_id)?.original_name || ''} 及关联路线`"
              title="删除此图片及其全部路线"
              @click="requestDelete(t.image_id)"
            >
              <Icon name="trash" :size="14" />
            </button>
          </div>
          <p v-if="!tasks.length" class="empty-mini">
            {{ search ? '没有找到匹配的路线' : '导入一张图片，开始画线。' }}
          </p>
        </div>
        <button v-if="asset" class="button full" @click="newTaskFor()">
          <Icon name="plus" :size="15" />当前图片新建路线
        </button>
        <button
          v-if="trash.length"
          class="text-button restore-image-button"
          @click="restoreLastImage"
        >
          <Icon name="undo" :size="14" />恢复最近删除<span class="count">{{ trash.length }}</span>
        </button>
        <div class="sidebar-footnote">
          <Icon name="database" :size="14" /><span
            >本地自动保存<br /><small>定期导出备份，保留你的路线。</small></span
          >
        </div>
      </aside>
      <main class="main-shell">
        <Workspace
          v-if="task && asset && url"
          :key="task.id"
          :project="project"
          :task="task"
          :asset="asset"
          :url="url"
          :save-state="state"
          @dirty="dirty"
          @save="persist"
          @message="message"
          @previous="adjacent(-1)"
          @next="adjacent(1)"
          @export="backup"
        />
        <div v-else class="workspace-empty">
          <span class="empty-icon"><Icon name="brush" :size="32" /></span>
          <h1>从一张图片，一条路线开始。</h1>
          <p>导入场景，在图上画出你想要的镜头运动。</p>
          <button class="button primary" @click="uploadInput?.click()">
            <Icon name="plus" :size="17" />选择图片</button
          ><small>支持 PNG、JPEG、WebP</small>
        </div>
      </main>
    </div>
  </div>
  <input
    ref="uploadInput"
    type="file"
    accept="image/png,image/jpeg,image/webp"
    multiple
    hidden
    @change="handleUpload"
  /><input ref="zipInput" type="file" accept=".zip,application/zip" hidden @change="handleImport" />
  <Transition name="toast"
    ><div v-if="toast" class="toast-message" role="status">
      <Icon name="info" :size="17" /><span>{{ toast }}</span
      ><button class="icon-link" aria-label="关闭通知" @click="toast = ''">
        <Icon name="x" :size="14" />
      </button></div
  ></Transition>
  <div v-if="busy" class="busy-overlay">
    <span class="spinner" /><strong>{{ busy }}</strong>
  </div>
  <DeleteImageDialog
    v-if="deletionImage"
    :name="deletionImage.original_name"
    :count="deletionCount"
    :busy="deleting"
    @cancel="pendingDelete = null"
    @confirm="confirmDelete"
  />
  <div v-if="showHelp" class="modal-backdrop" @click.self="showHelp = false">
    <div class="modal">
      <div class="modal-header">
        <h2>路线工作台</h2>
        <button class="icon-link" aria-label="关闭帮助" @click="showHelp = false">
          <Icon name="x" :size="19" />
        </button>
      </div>
      <p class="help-copy">
        导入图片 → 绘制路线 → 记录意图 → 保存或导出。可以为同一图片创建多条独立的路线任务。
      </p>
      <div class="shortcuts">
        <span
          v-for="s in [
            ['B', '绘制'],
            ['V', '选择 / 移动'],
            ['E', '编辑顶点'],
            ['H', '平移'],
            ['Space', '临时平移'],
            ['Ctrl Z', '撤销'],
            ['Ctrl ⇧ Z', '重做'],
            ['Ctrl S', '保存'],
            ['Delete', '删除'],
          ]"
          :key="s[0]"
          ><kbd>{{ s[0] }}</kbd
          >{{ s[1] }}</span
        >
      </div>
      <p class="help-copy">
        顶点编辑时，双击路线插点，Alt +
        单击顶点删点。笔刷参数只影响下一笔。数据保存在当前浏览器中，请定期导出 ZIP 备份。
      </p>
      <div class="modal-actions">
        <button class="button primary" @click="showHelp = false">知道了</button>
      </div>
    </div>
  </div>
</template>
