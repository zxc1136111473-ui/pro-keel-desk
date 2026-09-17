/**
 * Cordis 对未 inject 的服务做属性访问会抛
 * `cannot get property "…" without inject`，整棵 client plugin tree 随之失败。
 * 可选服务只能走 ctx.get()，并吞掉 inject 异常。
 */
export function optionalService(ctx, name) {
  if (typeof ctx?.get !== 'function') return undefined
  try {
    return ctx.get(name)
  } catch {
    return undefined
  }
}
