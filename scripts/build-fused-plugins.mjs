#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)))

const plugins = [
  { id: 'dsh-desktop-manager', script: 'scripts/build.mjs' },
  { id: 'dsh-layered-memory', script: 'scripts/build.mjs' },
  { id: 'dsh-quick-commands', script: 'scripts/build.mjs' },
  { id: 'dsh-retry', script: 'scripts/build.mjs' },
  { id: 'dsh-open-external', script: 'scripts/build.mjs' },
]

function run(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: 'inherit' })
    child.on('error', reject)
    child.on('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`${command} ${args.join(' ')} exited ${code}`))
    })
  })
}

for (const plugin of plugins) {
  const root = join(repoRoot, 'packages', plugin.id)
  const script = join(root, plugin.script)
  if (!existsSync(script)) {
    console.log(`[fused-plugins] skip ${plugin.id}: no ${plugin.script}`)
    continue
  }
  console.log(`[fused-plugins] building ${plugin.id}`)
  await import(`${pathToFileURL(script).href}?build=${Date.now()}`)
}

const infinite = join(repoRoot, 'packages', 'dsh-infinite-gen-1', 'index.js')
if (existsSync(infinite)) {
  await run(process.execPath, ['--check', infinite], repoRoot)
  console.log('[fused-plugins] checked dsh-infinite-gen-1')
}

console.log('[fused-plugins] done')
