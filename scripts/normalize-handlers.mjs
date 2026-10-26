// Vue 3.6 RC currently parses multiline bare event statements differently from
// the formatter. Explicit arrow bodies preserve ASI and event argument scope.
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
const root = resolve('src')
async function walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = resolve(dir, entry.name)
    if (entry.isDirectory()) await walk(path)
    else if (entry.name.endsWith('.vue')) {
      const source = await readFile(path, 'utf8')
      const fixed = source.replace(/(@[\w:.-]+)="([\s\S]*?)"/g, (all, key, value) => value.includes('\n') && !value.trim().startsWith('($event) => {') ? `${key}="($event) => {\n${value}\n}"` : all)
      if (fixed !== source) await writeFile(path, fixed)
    }
  }
}
await walk(root)
