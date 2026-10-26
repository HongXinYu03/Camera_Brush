import { computed, onMounted, onBeforeUnmount, ref } from 'vue'
import type { Project, ImageAsset } from '../lib/types'
import { newProject, clone, uid, now } from '../lib/types'
import {
  readAllProjects,
  saveProject,
  getData,
  putData,
  deleteDraft,
  ConflictError,
} from '../lib/storage'
import { normalizeImage, createTask, exportProject, importProject, download } from '../lib/data'
import { visibleTasks, deletedImages, deleteImage, restoreImage } from '../lib/images'

export function useApp() {
  const projects = ref<Project[]>([]),
    currentId = ref(''),
    selectedTask = ref('')
  const ready = ref(false),
    error = ref(''),
    toast = ref(''),
    busy = ref(''),
    state = ref('已保存到此浏览器')
  const uploadInput = ref<HTMLInputElement>(),
    zipInput = ref<HTMLInputElement>()
  const showHelp = ref(false),
    conflict = ref(false),
    search = ref('')
  const pendingDelete = ref<{ imageId: string; projectId: string } | null>(null)
  const deleting = ref(false)
  const project = computed(() => projects.value.find((p) => p.id === currentId.value))
  const activeTasks = computed(() => (project.value ? visibleTasks(project.value) : []))
  const trash = computed(() => (project.value ? deletedImages(project.value) : []))
  const deletionImage = computed(() =>
    pendingDelete.value?.projectId === currentId.value
      ? project.value?.images.find((i) => i.id === pendingDelete.value?.imageId && !i.deleted_at)
      : undefined,
  )
  const deletionCount = computed(
    () => project.value?.tasks.filter((t) => t.image_id === deletionImage.value?.id).length || 0,
  )
  const task = computed(() => activeTasks.value.find((t) => t.id === selectedTask.value))
  const asset = computed(() => project.value?.images.find((i) => i.id === task.value?.image_id))
  const urls = ref<Record<string, string>>({})
  const url = computed(() => (asset.value ? urls.value[asset.value.id] || '' : ''))
  const tasks = computed(
    () =>
      activeTasks.value.filter(
        (t) =>
          !search.value ||
          t.name.toLowerCase().includes(search.value.toLowerCase()) ||
          project.value?.images
            .find((i) => i.id === t.image_id)
            ?.original_name.toLowerCase()
            .includes(search.value.toLowerCase()),
      ) || [],
  )
  let edits = 0,
    saved = 0,
    timer: ReturnType<typeof setTimeout> | undefined,
    draftTimer: ReturnType<typeof setTimeout> | undefined,
    toastTimer: ReturnType<typeof setTimeout> | undefined
  let saving: Promise<boolean> | null = null,
    channel: BroadcastChannel | undefined

  function message(text: string) {
    toast.value = text
    clearTimeout(toastTimer)
    toastTimer = setTimeout(() => (toast.value = ''), 5000)
  }
  async function writeDraft() {
    if (!project.value) return
    try {
      await putData('drafts', project.value.id, {
        project: clone(project.value),
        baseVersion: project.value.version,
      })
    } catch {
      state.value = '保存失败，请导出备份'
    }
  }
  function dirty() {
    if (!project.value) return
    if (task.value) task.value.updated_at = now()
    edits++
    state.value = '尚有未保存修改'
    clearTimeout(timer)
    clearTimeout(draftTimer)
    draftTimer = setTimeout(() => void writeDraft(), 180)
    timer = setTimeout(() => void persist(), 700)
  }
  async function persist(): Promise<boolean> {
    clearTimeout(timer)
    clearTimeout(draftTimer)
    if (saving) {
      const success = await saving
      if (success && edits > saved) return persist()
      return success
    }
    if (!project.value || conflict.value) return false
    if (edits === saved && project.value.version > 0) return true
    const p = project.value,
      count = edits
    state.value = '正在保存…'
    saving = (async () => {
      try {
        p.version = await saveProject(clone(p), p.version)
        saved = count
        state.value = '已保存到此浏览器'
        channel?.postMessage({ id: p.id, version: p.version })
        return true
      } catch (e) {
        await writeDraft()
        conflict.value = e instanceof ConflictError
        state.value = conflict.value ? '版本冲突 · 本地副本已保留' : '保存失败，请导出备份'
        if (!conflict.value) message(state.value)
        return false
      } finally {
        saving = null
      }
    })()
    const success = await saving
    if (success && edits > saved) return persist()
    return success
  }
  async function loadUrls() {
    for (const image of project.value?.images.filter((i) => !i.deleted_at) || [])
      if (!urls.value[image.id]) {
        const blob = await getData<Blob>('assets', image.id)
        if (blob) urls.value[image.id] = URL.createObjectURL(blob)
      }
  }
  function rememberTask() {
    localStorage.setItem(`camera-brush-task:${currentId.value}`, selectedTask.value)
  }
  async function selectProject(id: string, initial = false) {
    if (!initial && !(await persist())) return
    currentId.value = id
    pendingDelete.value = null
    edits = 0
    saved = 0
    conflict.value = false
    search.value = ''
    state.value = '已保存到此浏览器'
    const p = project.value
    if (!p) return
    const draft = await getData<{ project: Project; baseVersion: number }>('drafts', id)
    if (draft) {
      if (draft.baseVersion === p.version) {
        projects.value[projects.value.findIndex((p) => p.id === id)] = draft.project
        edits++
        state.value = '已恢复未保存草稿'
        timer = setTimeout(() => void persist(), 700)
      } else {
        conflict.value = true
        state.value = '本地草稿与已保存版本冲突'
      }
    }
    const previous = localStorage.getItem(`camera-brush-task:${id}`)
    selectedTask.value =
      activeTasks.value.find((t) => t.id === previous)?.id || activeTasks.value[0]?.id || ''
    await loadUrls()
    localStorage.setItem('camera-brush-project', id)
  }
  async function changeProject(e: Event) {
    await selectProject((e.target as HTMLSelectElement).value)
    ;(e.target as HTMLSelectElement).value = currentId.value
  }
  async function openTask(id: string) {
    if (!activeTasks.value.some((t) => t.id === id)) return
    if (id === selectedTask.value) return
    if (!(await persist())) return
    selectedTask.value = id
    rememberTask()
  }
  async function adjacent(offset: number) {
    const list = activeTasks.value,
      i = list.findIndex((t) => t.id === selectedTask.value),
      next = list[(i + offset + list.length) % list.length]
    if (next) await openTask(next.id)
  }
  async function newTaskFor(image: ImageAsset | undefined = asset.value) {
    if (!project.value || !image || image.deleted_at || !(await persist())) return
    const t = createTask(project.value, image.id)
    selectedTask.value = t.id
    dirty()
    rememberTask()
  }
  function requestDelete(imageId: string) {
    if (project.value?.images.some((i) => i.id === imageId && !i.deleted_at))
      pendingDelete.value = { imageId, projectId: currentId.value }
  }
  async function confirmDelete() {
    const imageId = deletionImage.value?.id,
      p = project.value
    if (!p || !imageId || deleting.value) return
    deleting.value = true
    try {
      if (!(await persist()) || currentId.value !== pendingDelete.value?.projectId) return
      const count = deleteImage(p, imageId)
      pendingDelete.value = null
      if (!activeTasks.value.some((t) => t.id === selectedTask.value))
        selectedTask.value = activeTasks.value[0]?.id || ''
      search.value = ''
      rememberTask()
      dirty()
      await persist()
      message(`图片及 ${count} 条路线已移除，可点击“恢复最近删除”找回。`)
    } finally {
      deleting.value = false
    }
  }
  async function restoreLastImage() {
    const p = project.value,
      imageId = trash.value[0]?.id
    if (!p || !imageId || !(await persist())) return
    const image = restoreImage(p, imageId)
    if (!image) return
    selectedTask.value =
      p.tasks.find((t) => t.image_id === imageId)?.id || createTask(p, imageId).id
    search.value = ''
    await loadUrls()
    rememberTask()
    dirty()
    await persist()
    message('图片及其全部路线已恢复。')
  }
  async function handleUpload(e: Event) {
    const input = e.target as HTMLInputElement,
      files = Array.from(input.files || [])
    input.value = ''
    if (!files.length || !project.value || !(await persist())) return
    busy.value = '正在导入图片…'
    let added = 0,
      reused = 0,
      firstTask = ''
    const errors: string[] = []
    try {
      for (const file of files)
        try {
          const { asset, image, source } = await normalizeImage(file, file.name)
          const duplicate = project.value.images.find(
            (i) => i.sha256 === asset.sha256 || i.source_sha256 === asset.source_sha256,
          )
          if (duplicate) {
            restoreImage(project.value, duplicate.id)
            reused++
            firstTask ||=
              project.value.tasks.find((t) => t.image_id === duplicate.id)?.id ||
              createTask(project.value, duplicate.id).id
            continue
          }
          await putData('assets', asset.id, image)
          await putData('assets', `source:${asset.id}`, source)
          project.value.images.push(asset)
          const t = createTask(project.value, asset.id)
          firstTask ||= t.id
          urls.value[asset.id] = URL.createObjectURL(image)
          added++
        } catch (e) {
          errors.push(`${file.name}：${(e as Error).message}`)
        }
      if (firstTask) {
        selectedTask.value = firstTask
        await loadUrls()
        dirty()
        rememberTask()
        await persist()
      }
      message(
        `已导入 ${added} 张图片${reused ? `，复用 ${reused} 张已有图片` : ''}${errors.length ? `；${errors.join('；')}` : ''}`,
      )
    } finally {
      busy.value = ''
    }
  }
  async function handleImport(e: Event) {
    const input = e.target as HTMLInputElement,
      file = input.files?.[0]
    input.value = ''
    if (!file || !(await persist())) return
    busy.value = '正在校验并导入备份…'
    try {
      const p = await importProject(file)
      projects.value.push(p)
      await selectProject(p.id)
      dirty()
      await persist()
      message('备份已恢复为独立副本。')
    } catch (e) {
      message((e as Error).message)
    } finally {
      busy.value = ''
    }
  }
  async function backup() {
    if (!project.value) return
    busy.value = '正在导出备份…'
    try {
      download(
        await exportProject(clone(project.value), 'research_full'),
        `camera-brush-${project.value.id.slice(0, 8)}.zip`,
      )
      message('ZIP 备份已导出。')
    } catch (e) {
      message((e as Error).message)
    } finally {
      busy.value = ''
    }
  }
  async function reloadConflict() {
    if (!project.value) return
    const id = currentId.value
    await deleteDraft(id)
    projects.value = await readAllProjects()
    await selectProject(id, true)
  }
  async function copyConflict() {
    if (!project.value) return
    const draft = await getData<{ project: Project }>('drafts', currentId.value),
      p = clone(draft?.project || project.value)
    p.id = uid()
    p.name += ' · 本地副本'
    p.version = 0
    projects.value.push(p)
    currentId.value = p.id
    conflict.value = false
    edits = 1
    saved = 0
    await persist()
    localStorage.setItem('camera-brush-project', p.id)
    message('本地修改已另存为副本。')
  }
  function beforeUnload(e: BeforeUnloadEvent) {
    if (edits > saved || conflict.value) {
      void writeDraft()
      e.preventDefault()
      e.returnValue = ''
    }
  }
  onMounted(async () => {
    try {
      projects.value = await readAllProjects()
      if (!projects.value.length) {
        const p = newProject('我的路线')
        p.version = await saveProject(p, 0)
        projects.value.push(p)
      }
      const previous = localStorage.getItem('camera-brush-project')
      await selectProject(
        projects.value.find((p) => p.id === previous)?.id || projects.value[0]!.id,
        true,
      )
      if (typeof BroadcastChannel !== 'undefined') {
        channel = new BroadcastChannel('camera-brush-sync')
        channel.onmessage = async (e) => {
          if (e.data.id !== currentId.value || e.data.version <= (project.value?.version || 0))
            return
          if (edits > saved || saving) {
            await writeDraft()
            conflict.value = true
            state.value = '其他标签页有新版本'
          } else {
            const p = (await readAllProjects()).find((p) => p.id === currentId.value)
            if (p) {
              projects.value[projects.value.findIndex((p) => p.id === currentId.value)] = p
              if (!activeTasks.value.some((t) => t.id === selectedTask.value)) {
                selectedTask.value = activeTasks.value[0]?.id || ''
                rememberTask()
              }
              await loadUrls()
            }
          }
        }
      }
      window.addEventListener('beforeunload', beforeUnload)
      ready.value = true
    } catch (e) {
      error.value = `无法打开浏览器本地数据：${(e as Error).message}`
      ready.value = true
    }
  })
  onBeforeUnmount(() => {
    clearTimeout(timer)
    clearTimeout(draftTimer)
    clearTimeout(toastTimer)
    channel?.close()
    Object.values(urls.value).forEach(URL.revokeObjectURL)
    window.removeEventListener('beforeunload', beforeUnload)
  })
  return {
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
  }
}
