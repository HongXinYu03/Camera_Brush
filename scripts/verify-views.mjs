import { createServer } from 'vite'
import { createSSRApp, h } from 'vue'
import { renderToString } from '@vue/server-renderer'
globalThis.window = { Blob, devicePixelRatio: 1 }
globalThis.document = { createElement: () => ({ getContext: () => ({}) }) }
const server = await createServer({
  server: { middlewareMode: true, ws: false },
  appType: 'custom',
})
try {
  const { newProject, newTask } = await server.ssrLoadModule('/src/lib/types.ts')
  const project = newProject('Smoke test'),
    image = {
      id: 'image',
      original_name: 'test.png',
      width: 1600,
      height: 900,
      scene: 'scene',
      style: 'style',
      split: 'unassigned',
      scene_family_id: 'family',
      sha256: 'a'.repeat(64),
      objects: [],
      object_revisions: [],
    }
  project.images.push(image)
  const task = newTask('image', 1)
  project.tasks.push(task)
  for (const name of ['Workspace']) {
    const { default: Component } = await server.ssrLoadModule(`/src/components/${name}.vue`)
    const html = await renderToString(
      createSSRApp({
        render: () =>
          h(Component, { project, urls: {}, task, asset: image, url: '', saveState: '已保存' }),
      }),
    )
    if (!html || html.length < 500) throw new Error(`${name}: empty output`)
    if (html.includes('undefined')) throw new Error(`${name}: undefined data in output`)
    if (
      ['实验工作台', '项目概览', '研究标注', '冻结快照', '参与者采集模式'].some((label) =>
        html.includes(label),
      )
    )
      throw new Error('Removed sections remain in the simple workspace')
    for (const label of ['路线图层', '运动意图', '保存路线', '笔刷设置'])
      if (!html.includes(label)) throw new Error(`Missing essential control: ${label}`)
    console.log(`${name}: rendered (${html.length} chars)`)
  }
  const { default: Dialog } = await server.ssrLoadModule('/src/components/DeleteImageDialog.vue')
  const dialogHtml = await renderToString(
    createSSRApp({ render: () => h(Dialog, { name: 'example.png', count: 3, busy: false }) }),
  )
  if (
    !dialogHtml.includes('role="dialog"') ||
    !dialogHtml.includes('example.png') ||
    !dialogHtml.includes('3 条路线') ||
    !dialogHtml.includes('取消')
  )
    throw new Error('Image deletion confirmation lacks essential details')
  console.log('DeleteImageDialog: filename, route count, cancel and dialog semantics verified')
} finally {
  await server.close()
}
