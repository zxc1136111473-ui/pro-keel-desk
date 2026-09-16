//#region lib/types/invariant.js
/**
* Package-owned invariant companion for `@deepseek-ai/dsh-tui`.
* @module @deepseek-ai/dsh-tui/invariant
*/
const PACKAGE_NAME = "@deepseek-ai/dsh-tui";
/** Cordis companion plugin name. */
const name = "tui-invariant";
/** Service required before the companion can register. */
const inject = ["invariants"];
/**
* No runtime invariant: the runner is an interactive driver over the API carrier
* whose observable contract (assistant text per turn, exit code on /quit) is
* process-level and owned by the launcher e2e; it registers nothing and holds no
* mutable relation to audit inside the tree.
*/
const install = () => {};
/**
* Register this package's invariant companion.
* @param ctx - Cordis context carrying the invariant service.
* @returns the installed registration's disposer after setup succeeds.
*/
const apply = (ctx) => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install));
//#endregion
export { apply, inject, name };
