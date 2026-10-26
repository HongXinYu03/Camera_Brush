<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue'
import Icon from './Icon.vue'
const props = defineProps<{ name: string; count: number; busy: boolean }>()
const emit = defineEmits<{ cancel: []; confirm: [] }>()
const cancel = ref<HTMLButtonElement>(),
  confirm = ref<HTMLButtonElement>()
let previous: HTMLElement | null = null
function keyboard(e: KeyboardEvent) {
  e.stopPropagation()
  if (e.key === 'Escape' && !props.busy) emit('cancel')
  if (e.key === 'Tab') {
    e.preventDefault()
    ;(document.activeElement === cancel.value && !confirm.value?.disabled
      ? confirm.value
      : cancel.value
    )?.focus()
  }
}
onMounted(() => {
  previous = document.activeElement as HTMLElement
  cancel.value?.focus()
})
onBeforeUnmount(() => {
  if (previous?.isConnected) previous.focus()
})
</script>
<template>
  <div class="modal-backdrop" @click.self="!busy && emit('cancel')" @keydown="keyboard">
    <section
      class="modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-image-title"
      aria-describedby="delete-image-description"
    >
      <div class="modal-header">
        <h2 id="delete-image-title">删除这张图片？</h2>
        <button
          class="icon-link"
          aria-label="取消删除图片"
          :disabled="busy"
          @click="emit('cancel')"
        >
          <Icon name="x" :size="19" />
        </button>
      </div>
      <p class="deletion-filename">{{ name }}</p>
      <p id="delete-image-description" class="help-copy">
        该图片及其关联的
        {{ count }} 条路线会从当前列表中移除。删除后可点击“恢复最近删除”，找回图片、笔划和意图记录。
      </p>
      <div class="modal-actions">
        <button ref="cancel" class="button" :disabled="busy" @click="emit('cancel')">取消</button
        ><button ref="confirm" class="button primary" :disabled="busy" @click="emit('confirm')">
          <Icon name="trash" :size="15" />{{ busy ? '正在删除…' : '删除图片及关联路线' }}
        </button>
      </div>
    </section>
  </div>
</template>
