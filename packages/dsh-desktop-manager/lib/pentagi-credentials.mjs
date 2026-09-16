import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

export function userHome(env = process.env) {
  const configured = String(env.DSH_HOME ?? '').trim()
  if (configured) return resolve(configured)
  return join(homedir(), '.dsh')
}

/**
 * Official desktop credentials are `$DSH_HOME/.credentials.yaml`:
 *   version: 1
 *   refs:
 *     GROK2_API_KEY: sk-…
 *   records: …
 * CLI / older files are a flat `KEY: value` mapping. Indentation must not
 * drop keys — that is what made 「同步 Harness 模型」 report no API key.
 */
export function parseCredentialsYaml(text) {
  const out = {}
  for (const raw of String(text || '').split(/\r?\n/)) {
    const m = raw.match(/^\s*([A-Z][A-Z0-9_]*):\s*(.+?)\s*$/)
    if (!m) continue
    const value = m[2].trim().replace(/^['"]|['"]$/g, '')
    if (!value || value === '|' || value === '>' || value === '{}') continue
    out[m[1]] = value
  }
  return out
}

export function credentialHomes(env = process.env) {
  if (String(env.DSH_HOME ?? '').trim()) return [userHome(env)]
  const candidates = [
    join(homedir(), '.dsh'),
    join(homedir(), 'AppData', 'Roaming', 'dsh-desktop', 'harness'),
    join(homedir(), 'Library', 'Application Support', 'dsh-desktop', 'harness'),
  ]
  const seen = new Set()
  const homes = []
  for (const home of candidates) {
    const resolved = resolve(home)
    if (seen.has(resolved)) continue
    seen.add(resolved)
    if (existsSync(join(resolved, 'settings.yaml')) || existsSync(join(resolved, '.credentials.yaml'))) {
      homes.push(resolved)
    }
  }
  return homes.length ? homes : [join(homedir(), '.dsh')]
}

export function readHarnessCredentials(env = process.env) {
  const out = {}
  for (const home of credentialHomes(env)) {
    const file = join(home, '.credentials.yaml')
    if (!existsSync(file)) continue
    Object.assign(out, parseCredentialsYaml(readFileSync(file, 'utf8')))
  }
  return out
}

export function readHarnessSettingsText(env = process.env) {
  const homes = credentialHomes(env)
  const primary = userHome(env)
  const ordered = [primary, ...homes.filter((home) => home !== primary)]
  for (const home of ordered) {
    const file = join(home, 'settings.yaml')
    if (!existsSync(file)) continue
    const text = readFileSync(file, 'utf8')
    if (/^llm-pi-ai:/m.test(text)) return { text, file }
  }
  const fallback = join(primary, 'settings.yaml')
  return {
    text: existsSync(fallback) ? readFileSync(fallback, 'utf8') : '',
    file: fallback,
  }
}
