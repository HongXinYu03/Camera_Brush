import { test } from 'node:test'
import assert from 'node:assert/strict'
import { newProject, newTask, clone, uid, now } from '../src/lib/types.ts'
import type { ImageAsset } from '../src/lib/types.ts'
import { visibleTasks, deletedImages, deleteImage, restoreImage } from '../src/lib/images.ts'
import { validateProject } from '../src/lib/data.ts'

function fixture() {
  const p = newProject('images')
  const a: ImageAsset = {
    id: uid(),
    original_name: 'a.png',
    width: 1600,
    height: 900,
    original_width: 1600,
    original_height: 900,
    sha256: 'a'.repeat(64),
    source_sha256: 'b'.repeat(64),
    source_type: 'uploaded',
    scene: '',
    style: '',
    perspective: '',
    difficulty: '',
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
  const b = {
    ...clone(a),
    id: uid(),
    original_name: 'b.png',
    sha256: 'c'.repeat(64),
    scene_family_id: uid(),
  }
  p.images.push(a, b)
  p.tasks.push(newTask(a.id, 1), newTask(a.id, 2), newTask(a.id, 3), newTask(b.id, 4))
  p.tasks[0]!.annotation.original_intent_text = 'Keep my intent'
  return { p, a, b }
}

test('deleting one image removes all its routes from navigation, preserving others', () => {
  const { p, a, b } = fixture()
  assert.equal(deleteImage(p, a.id), 3)
  assert.equal(visibleTasks(p).length, 1)
  assert.equal(visibleTasks(p)[0]!.image_id, b.id)
  assert.equal(p.tasks.length, 4)
  assert.equal(p.tasks[0]!.annotation.original_intent_text, 'Keep my intent')
  assert.doesNotThrow(() => validateProject(p))
})

test('deleting the final image leaves an empty navigable workspace', () => {
  const { p, a, b } = fixture()
  deleteImage(p, a.id)
  deleteImage(p, b.id)
  assert.deepEqual(visibleTasks(p), [])
  assert.equal(deletedImages(p).length, 2)
  assert.equal(deletedImages(p)[0]!.id, b.id)
  assert.doesNotThrow(() => validateProject(p))
})

test('restore survives JSON persistence with exact route, intent and revision content', async () => {
  const { p, a } = fixture()
  const original = JSON.stringify(p.tasks)
  deleteImage(p, a.id)
  const packageBlob = await import('../src/lib/zip.ts').then((m) =>
    m.makeZip({ 'project.json': JSON.stringify(p) }),
  )
  const files = await import('../src/lib/zip.ts').then((m) => m.readZip(packageBlob))
  const restored = JSON.parse(await files.get('project.json')!.text()) as typeof p
  assert.equal(visibleTasks(restored).length, 1)
  assert.equal(deletedImages(restored)[0]!.id, a.id)
  assert.equal(restoreImage(restored, a.id)?.id, a.id)
  assert.equal(visibleTasks(restored).length, 4)
  assert.equal(JSON.stringify(restored.tasks), original)
  assert.equal(deletedImages(restored).length, 0)
})

test('image removal does not alter frozen data or another workspace sharing the same image', () => {
  const { p, a } = fixture(),
    other = clone(p),
    snapshot = clone({ images: p.images, tasks: p.tasks })
  p.snapshots.push({
    id: uid(),
    name: 'frozen',
    created_at: now(),
    sha256: 'frozen-content',
    ...snapshot,
  })
  const frozen = JSON.stringify(p.snapshots)
  deleteImage(p, a.id)
  assert.equal(JSON.stringify(p.snapshots), frozen)
  assert.equal(visibleTasks(other).length, 4)
  assert.ok(!other.images[0]!.deleted_at)
})

test('missing IDs, repeated deletes and repeated restores are harmless', () => {
  const { p, a } = fixture(),
    before = JSON.stringify(p)
  assert.equal(deleteImage(p, 'missing'), 0)
  assert.equal(restoreImage(p, 'missing'), undefined)
  assert.equal(JSON.stringify(p), before)
  deleteImage(p, a.id)
  const timestamp = a.deleted_at
  assert.equal(deleteImage(p, a.id), 0)
  assert.equal(a.deleted_at, timestamp)
  restoreImage(p, a.id)
  assert.equal(restoreImage(p, a.id), undefined)
  assert.equal(visibleTasks(p).length, 4)
})
