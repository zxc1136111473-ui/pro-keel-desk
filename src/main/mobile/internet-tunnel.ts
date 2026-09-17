import type { ChildProcess } from 'node:child_process'

export type InternetTunnelProvider = 'cloudflare' | 'pinggy'

export interface InternetTunnelInstance {
  provider: InternetTunnelProvider
  url: string
  process: ChildProcess
  stop: () => Promise<void>
}

export async function startTunnelWithFallback(options: {
  startCloudflare: () => Promise<InternetTunnelInstance>
  startPinggy: () => Promise<InternetTunnelInstance>
  preferred?: InternetTunnelProvider
  forceCloudflareFailure?: boolean
  log?: (message: string) => void
}): Promise<InternetTunnelInstance> {
  const preferred = options.preferred ?? 'cloudflare'
  const primary = preferred === 'pinggy' ? options.startPinggy : options.startCloudflare
  const secondary = preferred === 'pinggy' ? options.startCloudflare : options.startPinggy
  const primaryName = preferred === 'pinggy' ? 'Pinggy' : 'Cloudflare'
  const secondaryName = preferred === 'pinggy' ? 'Cloudflare' : 'Pinggy'
  try {
    if (preferred === 'cloudflare' && options.forceCloudflareFailure) {
      throw new Error('Cloudflare failure forced by DSH_TUNNEL_FORCE_PINGGY')
    }
    return await primary()
  } catch (primaryError) {
    const primaryMessage = errorMessage(primaryError)
    options.log?.(`[tunnel] ${primaryName} unavailable, falling back to ${secondaryName}: ${primaryMessage}`)
    try {
      return await secondary()
    } catch (secondaryError) {
      throw new Error(
        `Unable to create an internet tunnel. ${primaryName}: ${primaryMessage}; ${secondaryName}: ${errorMessage(secondaryError)}`
      )
    }
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
