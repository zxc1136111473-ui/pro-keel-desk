#!/usr/bin/env node
/**
 * Fused CLI entry for DSH Desktop.
 *
 * Official `@deepseek-ai/dsh@0.1.5-rc.2` exposes `dsh web`, `dsh plugin`, and
 * `--profile`. pro-v4 added a first-class `tui` profile/alias. This wrapper:
 *
 *   dsh                 → interactive TUI (pro-v4 default)
 *   dsh tui …           → --profile tui
 *   dsh web …           → official web launcher
 *   dsh plugin …        → official plugin manager
 *   dsh --profile …     → pass through
 *
 * The TUI profile is created on first use with `@deepseek-ai/dsh-base` +
 * `@deepseek-ai/dsh-tui`. Fused host plugins ride `--patch` so they load
 * without being declared as profile bundles.
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

function firstExisting(paths) {
  return paths.find((path) => existsSync(path))
}

const officialBin = firstExisting([
  join(here, '..', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'),
  join(here, 'app', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'),
  join(here, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'),
])
const fusedPatch = firstExisting([
  join(here, '..', 'build', 'dsh-fused-cli.patch.yml'),
  join(here, 'dsh-fused-cli.patch.yml'),
  join(here, '..', 'dsh-fused-cli.patch.yml'),
])

function dshHome() {
  const configured = String(process.env.DSH_HOME ?? '').trim()
  if (!configured) return join(homedir(), '.dsh')
  if (configured === '~') return homedir()
  if (configured.startsWith('~/') || configured.startsWith('~\\')) {
    return resolve(join(homedir(), configured.slice(2)))
  }
  return resolve(configured)
}

function ensureTuiProfile() {
  const dir = join(dshHome(), 'profiles', 'tui')
  mkdirSync(dir, { recursive: true })
  const manifest = join(dir, 'package.json')
  if (!existsSync(manifest)) {
    writeFileSync(manifest, `${JSON.stringify({
      name: 'dsh-profile-tui',
      private: true,
      dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-tui'] } },
    }, null, 2)}\n`)
  }
  const patch = join(dir, 'cordis.patch.yml')
  if (!existsSync(patch)) {
    writeFileSync(patch, '# fused tui user layer\n[]\n')
  }
  const workspace = join(dir, 'pnpm-workspace.yaml')
  if (!existsSync(workspace)) {
    writeFileSync(workspace, 'packages:\n  - .\n\nnodeLinker: hoisted\nautoInstallPeers: false\n')
  }
}

function withFusedPatch(args) {
  if (args.includes('--patch') || !fusedPatch) return args
  return [...args, '--patch', fusedPatch]
}

function rewriteArgv(argv) {
  const args = [...argv]
  if (args.length === 0) {
    ensureTuiProfile()
    return withFusedPatch(['--profile', 'tui'])
  }
  if (args[0] === 'tui') {
    ensureTuiProfile()
    return withFusedPatch(['--profile', 'tui', ...args.slice(1)])
  }
  if (args[0] === 'web') {
    return withFusedPatch(['web', ...args.slice(1)])
  }
  if (args[0] === 'plugin' || args[0] === '-h' || args[0] === '--help' || args[0] === '-V' || args[0] === '--version') {
    return args
  }
  if (args[0] === '--profile' && args[1]) {
    if (args[1] === 'tui') ensureTuiProfile()
    return withFusedPatch(args)
  }
  return args
}

if (!officialBin) {
  console.error('dsh: official launcher missing. Run npm ci in the dsh-desktop tree, or install DSH Desktop.')
  process.exit(1)
}

const forwarded = rewriteArgv(process.argv.slice(2))
const child = spawn(process.execPath, [officialBin, ...forwarded], {
  stdio: 'inherit',
  env: process.env,
})
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  process.exit(code ?? 1)
})
