<script setup lang="ts">
withDefaults(defineProps<{ name: string; size?: number }>(), { size: 20 })
const paths: Record<string, string> = {
  grid: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z',
  image:
    'M4 3h16a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM3 16l6-6 5 5 3-3 4 4M16 7h.01',
  brush: 'm14 4 6 6M4 20l5-1L21 7a2.8 2.8 0 0 0-4-4L5 15zM4 20l1-5',
  database:
    'M20 5c0 2-3.6 3-8 3S4 7 4 5s3.6-3 8-3 8 1 8 3zM4 5v14c0 2 3.6 3 8 3s8-1 8-3V5M4 12c0 2 3.6 3 8 3s8-1 8-3',
  flask: 'M9 3h6M10 3v6L4 19a1.3 1.3 0 0 0 1 2h14a1.3 1.3 0 0 0 1-2L14 9V3M8 13h8',
  plus: 'M12 5v14M5 12h14',
  arrow: 'M5 12h14m-5-5 5 5-5 5',
  chevron: 'm9 5 7 7-7 7',
  down: 'm6 9 6 6 6-6',
  upload: 'M12 16V3m-5 5 5-5 5 5M3 15v5a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1v-5',
  download: 'M12 3v13m-5-5 5 5 5-5M3 16v4a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1v-4',
  folder: 'M3 7V4h6l2 3h10v13H3z',
  check: 'm5 12 4 4L19 6',
  search: 'M21 21l-6-6M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0',
  clock: 'M12 8v5l3 2M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',
  settings:
    'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8M12 2v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10 2 2M5 19l2-2M17 7l2-2',
  select: 'm4 3 16 9-8 2-4 7z',
  hand: 'M8 13V5a2 2 0 0 1 4 0v7-8a2 2 0 0 1 4 0v8-6a2 2 0 0 1 4 0v10c0 8-10 9-13 3L3 12a2 2 0 0 1 3-2z',
  undo: 'M3 10h11a6 6 0 0 1 0 12M3 10l5-5M3 10l5 5',
  redo: 'M21 10H10a6 6 0 0 0 0 12M21 10l-5-5M21 10l-5 5',
  reverse: 'M4 7h16m-4-4 4 4-4 4M20 17H4m4-4-4 4 4 4',
  trash: 'M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7',
  save: 'M4 3h14l3 3v15H3V3zM7 3v6h10V3M7 21v-8h10v8',
  edit: 'M5 5h5M19 14v6H3V5M15 3l6 6-9 9H6v-6z',
  play: 'm8 4 13 8-13 8z',
  pause: 'M7 4h3v16H7zM14 4h3v16h-3z',
  fit: 'M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5M8 8h8v8H8z',
  minus: 'M5 12h14',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
  route:
    'M5 5a2 2 0 1 0 0 .1M5 7v3a4 4 0 0 0 4 4h6a4 4 0 0 1 4 4v1M17 19a2 2 0 1 0 4 0 2 2 0 0 0-4 0',
  info: 'M12 11v6M12 7h.01M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',
  alert: 'M12 8v5M12 17h.01M12 3 1 21h22z',
  lock: 'M6 10V7a6 6 0 0 1 12 0v3M4 10h16v11H4zM12 14v3',
  unlock: 'M6 10V7a6 6 0 0 1 11-3M4 10h16v11H4zM12 14v3',
  box: 'M3 3h18v18H3z',
  polygon: 'm5 4 15 3-3 14L2 15zM5 4v.01M20 7v.01M17 21v.01M2 15v.01',
  x: 'm6 6 12 12M6 18 18 6',
  help: 'M9 8a3 3 0 1 1 5 2c-2 1-2 2-2 3M12 17h.01M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',
  chart: 'M3 3v18h18M7 16v-5M12 16V7M17 16v-8',
  copy: 'M8 8h13v13H8zM16 8V3H3v13h5',
  star: 'm12 2 3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1z',
}
</script>
<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.65"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path :d="paths[name] || paths.grid" />
  </svg>
</template>
