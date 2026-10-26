import type { Project, ImageAsset, Task } from './types.ts'

// Keep the image, original Blob and tasks intact so a deletion can be recovered
// after refresh and never breaks frozen snapshots or another project sharing it.
export function visibleTasks(project: Project): Task[] {
  const visibleImages = new Set(project.images.filter((i) => !i.deleted_at).map((i) => i.id))
  return project.tasks.filter((t) => visibleImages.has(t.image_id))
}

export function deletedImages(project: Project): ImageAsset[] {
  return project.images
    .filter((i) => i.deleted_at)
    .sort((a, b) => b.deleted_at!.localeCompare(a.deleted_at!))
}

export function deleteImage(project: Project, imageId: string): number {
  const image = project.images.find((i) => i.id === imageId && !i.deleted_at)
  if (!image) return 0
  const last = project.images.reduce(
    (latest, i) => Math.max(latest, Date.parse(i.deleted_at || '') || 0),
    0,
  )
  image.deleted_at = new Date(Math.max(Date.now(), last + 1)).toISOString()
  return project.tasks.filter((t) => t.image_id === imageId).length
}

export function restoreImage(project: Project, imageId: string): ImageAsset | undefined {
  const image = project.images.find((i) => i.id === imageId && i.deleted_at)
  if (image) delete image.deleted_at
  return image
}
