import { randomUUID } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, extname, isAbsolute, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import z from "@deepseek-ai/schemastery";
import { installModelSelection } from "@deepseek-ai/dsh-agent";
import { ReasoningEffortId, createUserMessage } from "@deepseek-ai/dsh-llm";
import { Service } from "@deepseek-ai/cordis";
import { SessionId } from "@deepseek-ai/dsh-session";
import { ManualCompactionError } from "@deepseek-ai/dsh-compaction";
//#region ../../settings/settings/src/redact.ts
/** Whether a value is a plain data object the walker may recurse into. */
function isRecord(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
function walk(node, value, path, secrets) {
	if (node === void 0) return value;
	if (node.meta?.role === "secret") {
		secrets.push({
			path,
			set: value !== void 0
		});
		return;
	}
	switch (node.type) {
		case "object": {
			const properties = node.dict ?? {};
			const source = isRecord(value) ? value : void 0;
			const rebuilt = {};
			if (source !== void 0) for (const [key, entry] of Object.entries(source)) {
				if (key in properties) continue;
				rebuilt[key] = entry;
			}
			for (const [key, child] of Object.entries(properties)) {
				const stripped = walk(child, source?.[key], [...path, key], secrets);
				if (stripped !== void 0) rebuilt[key] = stripped;
			}
			return source === void 0 && Object.keys(rebuilt).length === 0 ? value : rebuilt;
		}
		case "dict": {
			if (!isRecord(value)) return value;
			const rebuilt = {};
			for (const [key, entry] of Object.entries(value)) {
				const stripped = walk(node.inner, entry, [...path, key], secrets);
				if (stripped !== void 0) rebuilt[key] = stripped;
			}
			return rebuilt;
		}
		case "array":
			if (!Array.isArray(value)) return value;
			return value.map((entry, index) => walk(node.inner, entry, [...path, String(index)], secrets));
		default: return value;
	}
}
//#endregion
//#region ../../settings/settings/src/index.ts
/**
* Service Definition for the user-settings capability seam (`ctx.settings`). Providers store one raw document of
* per-namespace sections; plugins register a namespace schema and read the
* resolved value, which layers schema defaults, the registrant's composition
* `base`, and the user document section, in that order.
* @module @deepseek-ai/dsh-settings
*/
const NAMESPACE_PATTERN = /^[a-z][a-z0-9-]*$/;
/**
* Brand a raw string as a {@link SettingsNamespace}.
* @param value - candidate namespace; lowercase kebab-case, as in plugin short names.
* @returns the branded namespace.
*/
function settingsNamespace(value) {
	if (!NAMESPACE_PATTERN.test(value)) throw new TypeError(`settings namespace "${value}" must match ${String(NAMESPACE_PATTERN)}`);
	return value;
}
/**
* Deep equality over JSON-compatible data (objects, arrays, primitives) — the
* Service Definition's single change-detection predicate, exported so the invariant
* companion checks exactly the implementation's relation.
* @param a - one JSON-compatible value.
* @param b - the other JSON-compatible value.
* @returns whether the two values are structurally equal.
*/
function deepEqualJson(a, b) {
	if (a === b) return true;
	if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
	if (Array.isArray(a) || Array.isArray(b)) {
		if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
		return a.every((entry, index) => deepEqualJson(entry, b[index]));
	}
	const left = a;
	const right = b;
	const keys = Object.keys(left);
	if (keys.length !== Object.keys(right).length) return false;
	return keys.every((key) => key in right && deepEqualJson(left[key], right[key]));
}
/** Whether a value is a plain data object (not an array, null, or class instance). */
function isPlainObject(value) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
	const proto = Object.getPrototypeOf(value);
	return proto === Object.prototype || proto === null;
}
/** Apply one path op to a detached section, returning the next section. */
function applyPathOp(section, op) {
	const [head, ...rest] = op.path;
	if (head === void 0) {
		if (op.op === "unset") return {};
		if (!isPlainObject(op.value)) throw new TypeError("settings mutate: setting the section root requires a plain object");
		return { ...op.value };
	}
	if (rest.length === 0) {
		if (op.op === "set") return {
			...section,
			[head]: op.value
		};
		const { [head]: _removed, ...kept } = section;
		return kept;
	}
	const child = section[head];
	if (!isPlainObject(child)) {
		if (op.op === "unset") return section;
		return {
			...section,
			[head]: applyPathOp({}, {
				...op,
				path: rest
			})
		};
	}
	return {
		...section,
		[head]: applyPathOp(child, {
			...op,
			path: rest
		})
	};
}
/**
* Layer `over` onto `under`: plain objects merge recursively, every other
* value (arrays included) replaces the lower layer wholesale. `over` never
* carries `undefined` entries — sections come from parsed documents and write
* snapshots pass {@link cloneJsonShaped}, which strips them so a sparse patch
* cannot erase lower keys.
*/
function mergeLayers(under, over) {
	if (over === void 0) return under;
	if (!isPlainObject(under) || !isPlainObject(over)) return over;
	const merged = { ...under };
	for (const [key, value] of Object.entries(over)) merged[key] = key in merged ? mergeLayers(merged[key], value) : value;
	return merged;
}
/** Recursively freeze one resolved value so handed-out snapshots stay immutable. */
function deepFreeze(value) {
	if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
	for (const entry of Object.values(value)) deepFreeze(entry);
	return Object.freeze(value);
}
Service.init;
//#endregion
//#region lib/types/index.js
/**
* @deepseek-ai/dsh-tui — interactive REPL runner. Creates one persistent Agent
* through the core registry, accepts user lines from stdin, submits each as
* a follow-up turn, and prints the final assistant text after quiescence.
* `/new` resets to a fresh session; `/quit` requests process exit.
*
* @module @deepseek-ai/dsh-tui
*/
const LLM_PI_AI_NS = "llm-pi-ai";
const AGENT_PRESET_NS = settingsNamespace("agent-presets");
const PERMISSION_NS = settingsNamespace("permission");
function memoryPath() {
	return join(String(process.env.DSH_HOME ?? "").trim() || join(homedir(), ".dsh"), "tui-memory.json");
}
function isMemoryEntry(value) {
	if (value === null || typeof value !== "object") return false;
	const entry = value;
	return typeof entry.id === "string" && typeof entry.content === "string" && typeof entry.ts === "number";
}
function loadMemory() {
	try {
		const d = JSON.parse(readFileSync(memoryPath(), "utf8"));
		if (Array.isArray(d)) return { entries: d.filter(isMemoryEntry) };
		if (d !== null && typeof d === "object" && Array.isArray(d.entries)) return { entries: d.entries.filter(isMemoryEntry) };
		return { entries: [] };
	} catch {
		return { entries: [] };
	}
}
function saveMemory(store) {
	writeFileSync(memoryPath(), JSON.stringify({ entries: store.entries }, null, 2));
}
function memorySearch(store, query, io) {
	if (!query) {
		io.stdout.write("(用法: /memory search <关键词>)\n");
		return;
	}
	const q = query.toLowerCase();
	const hits = store.entries.filter((e) => e.content.toLowerCase().includes(q)).sort((a, b) => b.ts - a.ts).slice(0, 8);
	if (!hits.length) {
		io.stdout.write("无匹配记忆。\n");
		return;
	}
	io.stdout.write(`找到 ${hits.length} 条：\n`);
	for (const e of hits) io.stdout.write(`[${e.id}] ${e.type ?? "fact"} · ${new Date(e.ts).toLocaleString()}\n  ${clip(e.content, 100)}\n`);
}
function memoryAdd(store, line, io) {
	const content = line.replace(/^\/memory\s+add\s*/i, "").trim();
	if (!content) {
		io.stdout.write("(用法: /memory add <内容>)\n");
		return;
	}
	const entry = {
		id: `m-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
		content,
		type: "fact",
		ts: Date.now()
	};
	store.entries.push(entry);
	saveMemory(store);
	io.stdout.write(`已存储 [${entry.id}]：${clip(content, 80)}\n`);
}
function memoryList(store, io) {
	if (!store.entries.length) {
		io.stdout.write("无记忆。\n");
		return;
	}
	io.stdout.write(`共 ${store.entries.length} 条记忆：\n`);
	for (const e of store.entries.slice(-10)) io.stdout.write(`[${e.id}] ${e.type ?? "fact"} · ${new Date(e.ts).toLocaleString()} · ${clip(e.content, 90)}\n`);
}
function memoryForget(store, line, io) {
	const id = line.replace(/^\/memory\s+(?:forget|delete)\s*/i, "").trim();
	if (!id) {
		io.stdout.write("(用法: /memory delete <id>)\n");
		return;
	}
	const idx = store.entries.findIndex((e) => e.id === id || e.id.startsWith(id));
	if (idx === -1) {
		io.stdout.write(`未找到记忆 ${id}\n`);
		return;
	}
	const removed = store.entries.splice(idx, 1)[0];
	if (removed === void 0) {
		io.stdout.write(`未找到记忆 ${id}\n`);
		return;
	}
	saveMemory(store);
	io.stdout.write(`已删除 [${removed.id}]：${clip(removed.content, 60)}\n`);
}
function agentPresetLabel(id) {
	if (id === "standard") return "标准模式";
	if (id === "code") return "PTC 模式";
	if (id === "minimal") return "极简模式";
	if (id === "cordis") return "创造模式";
	return id;
}
function permissionLabel(id) {
	if (id === "danger-full-access") return "Full access";
	if (id === "workspace-write") return "workspace-write";
	if (id === "read-only") return "read-only";
	return id;
}
/** Stable Cordis plugin name. */
const name = "tui-runner";
/** Core services required before the REPL loop can start. */
const inject = [
	"agentDefaultModel",
	"agents",
	"sessions",
	"tuiStartup"
];
const Config = z.object({
	sessionId: z.string().default(""),
	initialTask: z.string().default(""),
	provider: z.string().default(""),
	model: z.string().default(""),
	check: z.boolean().default(false)
});
/** Process streams the runner writes to; tests substitute captures. */
const internals = {
	stdout: process.stdout,
	stderr: process.stderr,
	stdin: process.stdin,
	createInterface
};
/**
* Enumerate every selectable model from the runtime settings: the pi-ai
* provider catalog plus the deepseek adapter. The deepseek adapter is mounted
* unconditionally with no settings model list, so its two known ids are
* offered directly.
* @param ctx - plugin context carrying the settings service.
* @returns provider/model pairs, deduplicated.
*/
function enumerateCatalog(ctx) {
	const modelsByProvider = /* @__PURE__ */ new Map();
	const push = (provider, model) => {
		const list = modelsByProvider.get(provider) ?? [];
		if (!list.includes(model)) list.push(model);
		modelsByProvider.set(provider, list);
	};
	const pi = ctx.get("settings")?.get(LLM_PI_AI_NS);
	for (const [provider, profile] of Object.entries(pi?.providers ?? {})) for (const raw of profile?.models ?? []) {
		const id = typeof raw === "string" ? raw : raw?.id;
		if (id) push(provider, id);
	}
	push("deepseek-official", "deepseek-v4-pro");
	push("deepseek-official", "deepseek-v4-flash");
	return {
		providers: [...modelsByProvider.keys()],
		modelsByProvider
	};
}
/** Read the baseURL for a provider from settings, with a sensible default for deepseek-official. */
function providerBaseUrl(ctx, provider) {
	return (ctx.get("settings")?.get(LLM_PI_AI_NS))?.providers?.[provider]?.baseURL ?? void 0;
}
/**
* Probe every provider's reachability concurrently (2s budget per probe).
* Results are stored in menu.reachable and can be refreshed.
*/
async function probeAllProviders(ctx, menu) {
	const results = await Promise.all(menu.providers.map(async (p) => {
		return [p, await probeProvider(p === "deepseek-official" ? void 0 : providerBaseUrl(ctx, p))];
	}));
	for (const [p, ok] of results) menu.reachable.set(p, ok);
}
function enumerateModels(ctx) {
	const catalog = enumerateCatalog(ctx);
	const out = [];
	for (const provider of catalog.providers) for (const model of catalog.modelsByProvider.get(provider) ?? []) out.push({
		provider,
		model
	});
	return out;
}
/**
* Render the numbered model menu and arm the menu state so the next input
* line is consumed as a choice. The requested switch only becomes the
* persistent default; applying it needs a fresh agent, so a successful pick
* asks the caller to relaunch the session through the /new path.
* @param ctx - plugin context carrying settings and the default-model service.
* @param io - process-facing effects.
* @param menu - the session's menu state to arm.
* @returns the model choices offered (for the consumer to match numbers).
*/
function renderProviderMenu(ctx, io, menu) {
	const current = ctx.get("agentDefaultModel")?.currentSelection();
	const catalog = enumerateCatalog(ctx);
	menu.stage = "provider";
	menu.providers = catalog.providers;
	menu.models = [];
	menu.provider = "";
	io.stdout.write("\n选择接口商 / API（输入编号，0 取消；✗=探测不到，可能连不上）：\n");
	io.stdout.write(`  当前: ${current?.provider}/${current?.model}\n`);
	catalog.providers.forEach((provider, index) => {
		const count = catalog.modelsByProvider.get(provider)?.length ?? 0;
		const mark = provider === current?.provider ? " *" : "";
		const reach = menu.reachable.get(provider);
		const tag = reach === true ? "" : reach === false ? "  ✗" : "";
		io.stdout.write(`  ${String(index + 1).padStart(2)}. ${provider}  （${count} 个模型）${mark}${tag}\n`);
	});
	io.stdout.write("   0. 取消\n");
	probeAllProviders(ctx, menu);
}
function renderModelMenuForProvider(ctx, io, menu, provider) {
	const current = ctx.get("agentDefaultModel")?.currentSelection();
	const models = enumerateCatalog(ctx).modelsByProvider.get(provider) ?? [];
	menu.stage = "model";
	menu.provider = provider;
	menu.models = models;
	io.stdout.write(`\n选择 ${provider} 的模型（输入编号，0 返回接口商）：\n`);
	io.stdout.write(`  当前: ${current?.provider}/${current?.model}\n`);
	io.stdout.write("  快速 / 1M 是不同模型 id，选中后再选思考档。\n");
	models.forEach((model, index) => {
		const mark = provider === current?.provider && model === current?.model ? " *" : "";
		io.stdout.write(`  ${String(index + 1).padStart(2)}. ${model}${modelHint(model)}${mark}\n`);
	});
	io.stdout.write("   0. 返回\n");
}
function modelHint(model) {
	const tags = [];
	const lower = model.toLowerCase();
	if (lower.includes("flash") || lower.includes("fast") || lower.includes("lite") || lower.includes("mini")) tags.push("快速");
	if (lower.includes("1m") || lower.includes("million") || /[-_]1m\b/.test(lower)) tags.push("1M");
	else if (lower.includes("pro") || lower.includes("max")) tags.push("1M");
	return tags.length === 0 ? "" : `  [${tags.join(" · ")}]`;
}
function effortLabel(id) {
	if (id === "off") return "关闭思考（更快）";
	if (id === "high") return "思考 High";
	if (id === "max") return "思考 Max";
	if (id === void 0) return "提供方默认";
	return `思考 ${id}`;
}
async function renderEffortMenu(ctx, io, menu, model) {
	const current = ctx.get("agentDefaultModel")?.currentSelection();
	const efforts = (await ctx.get("llm")?.resolveModelInfo(menu.provider, model).catch(() => void 0))?.reasoning?.efforts ?? [];
	menu.stage = "effort";
	menu.models = [model];
	menu.efforts = efforts.length === 0 ? [{ label: "提供方默认（此模型无思考档）" }] : [{ label: "提供方默认" }, ...efforts.map((effort) => ({
		id: String(effort.id),
		label: effortLabel(String(effort.id))
	}))];
	io.stdout.write(`\n选择 ${menu.provider}/${model} 的思考档（输入编号，0 返回模型）：\n`);
	io.stdout.write(`  当前: ${current?.provider}/${current?.model}${current?.reasoningEffort ? ` · ${effortLabel(String(current.reasoningEffort))}` : ""}\n`);
	menu.efforts.forEach((choice, index) => {
		io.stdout.write(`  ${String(index + 1).padStart(2)}. ${choice.label}\n`);
	});
	io.stdout.write("   0. 返回\n");
}
/**
* Persist the chosen model as the settings default and request a session
* relaunch so the new selection applies.
* @param ctx - plugin context carrying the default-model service.
* @param io - process-facing effects.
* @param menu - the armed menu state.
* @param input - the consumed input line.
* @returns 'new' when a valid choice was saved so the REPL restarts, else 'continue'.
*/
async function pickFromMenu(ctx, io, menu, input) {
	const trimmed = input.trim();
	if (menu.stage === "provider") {
		if (trimmed === "" || trimmed === "0") {
			menu.stage = "off";
			io.stdout.write("(已取消)\n");
			return "continue";
		}
		const index = Number(trimmed) - 1;
		const provider = menu.providers[index];
		if (!provider) {
			io.stdout.write(`(没有这个接口商: ${trimmed})\n`);
			return "continue";
		}
		renderModelMenuForProvider(ctx, io, menu, provider);
		return "continue";
	}
	if (menu.stage === "model") {
		if (trimmed === "" || trimmed === "0") {
			renderProviderMenu(ctx, io, menu);
			return "continue";
		}
		const index = Number(trimmed) - 1;
		const model = menu.models[index];
		if (!model) {
			io.stdout.write(`(没有这个模型: ${trimmed})\n`);
			return "continue";
		}
		await renderEffortMenu(ctx, io, menu, model);
		return "continue";
	}
	if (menu.stage === "effort") {
		if (trimmed === "" || trimmed === "0") {
			renderModelMenuForProvider(ctx, io, menu, menu.provider);
			return "continue";
		}
		const index = Number(trimmed) - 1;
		const choice = menu.efforts[index];
		const model = menu.models[0];
		if (!choice || !model) {
			io.stdout.write(`(没有这个思考档: ${trimmed})\n`);
			return "continue";
		}
		const next = {
			provider: menu.provider,
			model,
			...choice.id === void 0 ? {} : { reasoningEffort: ReasoningEffortId(choice.id) }
		};
		menu.stage = "off";
		await ctx.get("agentDefaultModel")?.saveSelection(next);
		io.stdout.write(`(已设为 ${next.provider}/${next.model} · ${choice.label} — 正在开新会话生效)\n`);
		return "new";
	}
	return "continue";
}
/** Per-turn hang guard: cancel a model call or tool chain after this long. */
const TURN_TIMEOUT_MS = 12e4;
/** Time budget for one provider reachability probe. */
const PROBE_TIMEOUT_MS = 2e3;
/**
* Lightweight reachability probe for a provider base URL: fetch its /models
* listing (or the bare origin for file-less local proxies) and consider the
* provider reachable on any HTTP response. Never throws.
* @param baseUrl - provider base URL from settings.
* @returns true when the endpoint answered.
*/
async function probeProvider(baseUrl) {
	if (!baseUrl) return false;
	try {
		const url = baseUrl.replace(/\/+$/, "") + "/models";
		const res = await fetch(url, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
		return res.ok || res.status < 500;
	} catch {
		return false;
	}
}
const ARMOR_CHOICES = [
	{
		mode: "coldbrew",
		label: "冷咖啡 2.1.0"
	},
	{
		mode: "reverify",
		label: "Reverify 0.9.0"
	},
	{
		mode: "pentagi",
		label: "PentAGI 1.0.0"
	}
];
/** Whole-line phrases the desktop GUI also treats as optional wake words. Played locally; they do not switch the kernel. */
const ARMOR_PLAY = [
	{
		re: /^(冷咖啡|cold\s*coffee|BREAK\/\/OPEN|\[\[ENI:PROFILE=MAX\]\]|\[\[CB:MAX\]\])$/i,
		ack: "MAX 已开，把对象发来"
	},
	{
		re: /^(reverify|\[\[RV:VERIFY\]\])$/i,
		ack: "Reverify 已开，把样本路径发来"
	},
	{
		re: /^(pentagi|\[\[PG:OPEN\]\])$/i,
		ack: "PentAGI 已开，把目标发来"
	}
];
function playArmorPhrase(line) {
	return ARMOR_PLAY.find((row) => row.re.test(line))?.ack ?? null;
}
function dshHome() {
	return String(process.env.DSH_HOME ?? "").trim() || join(homedir(), ".dsh");
}
function readDesktopSettings() {
	try {
		return JSON.parse(readFileSync(join(dshHome(), "desktop-settings.json"), "utf8"));
	} catch {
		return {};
	}
}
function readGlobalArmorMode() {
	const mode = readDesktopSettings().coldbrew?.armorMode;
	if (mode === "reverify" || mode === "pentagi" || mode === "coldbrew") return mode;
	return "coldbrew";
}
function persistGlobalArmorMode(mode) {
	const home = dshHome();
	const dest = join(home, "desktop-settings.json");
	const settings = readDesktopSettings();
	const coldbrew = settings.coldbrew ?? {};
	settings.coldbrew = {
		...coldbrew,
		armorMode: mode,
		defaultEnabled: coldbrew.defaultEnabled !== false
	};
	mkdirSync(home, { recursive: true });
	writeFileSync(dest, JSON.stringify(settings, null, 2));
}
function persistArmorSession(sessionId, mode, model) {
	const home = dshHome();
	const dest = join(home, "coldbrew-sessions.json");
	let sessions = {};
	try {
		sessions = JSON.parse(readFileSync(dest, "utf8"));
	} catch {
		sessions = {};
	}
	sessions[sessionId] = {
		enabled: true,
		model,
		mode
	};
	mkdirSync(home, { recursive: true });
	writeFileSync(dest, JSON.stringify(sessions, null, 2));
}
function readArmorSession(sessionId) {
	try {
		const row = JSON.parse(readFileSync(join(dshHome(), "coldbrew-sessions.json"), "utf8"))[sessionId];
		if (!row) return void 0;
		return {
			enabled: row.enabled === true,
			mode: String(row.mode ?? "")
		};
	} catch {
		return;
	}
}
function renderArmorMenu(io, menu) {
	const current = readGlobalArmorMode();
	menu.stage = "armor";
	io.stdout.write("\n选择工作模式（与桌面端「破甲管理」同一项，一次只能开一个；新会话才生效）：\n");
	ARMOR_CHOICES.forEach((choice, index) => {
		const mark = choice.mode === current ? " *" : "";
		io.stdout.write(`  ${index + 1}. ${choice.label}${mark}\n`);
	});
	io.stdout.write("   0. 取消\n");
}
async function renderPresetMenu(ctx, io, menu) {
	const roster = ctx.get("agentPresets");
	if (roster === void 0) {
		io.stdout.write("(当前没有 Agent 预设服务。桌面端设置 → Agent 预设 仍可改默认值。)\n");
		menu.stage = "off";
		return;
	}
	const list = (await roster.list()).filter((row) => row.broken === void 0);
	menu.presetIds = list.map((row) => row.id);
	menu.stage = "preset";
	const current = roster.defaultId;
	io.stdout.write("\n选择 Agent 预设（与桌面端同一项，新会话生效）：\n");
	list.forEach((row, index) => {
		const mark = row.id === current ? " *" : "";
		io.stdout.write(`  ${index + 1}. ${row.name ?? agentPresetLabel(row.id)} (${row.id})${mark}\n`);
		if (row.description) io.stdout.write(`     ${row.description}\n`);
	});
	io.stdout.write("   0. 取消\n");
}
async function pickPreset(ctx, menu, input, io) {
	const trimmed = input.trim();
	if (trimmed === "" || trimmed === "0") {
		menu.stage = "off";
		io.stdout.write("(已取消)\n");
		return "continue";
	}
	const id = menu.presetIds[Number(trimmed) - 1];
	if (id === void 0) {
		io.stdout.write(`(没有这个预设: ${trimmed})\n`);
		return "continue";
	}
	try {
		await ctx.get("settings")?.update(AGENT_PRESET_NS, { default: id });
	} catch (error) {
		io.stderr.write(`dsh: 未能写入预设: ${error instanceof Error ? error.message : String(error)}\n`);
		menu.stage = "off";
		return "continue";
	}
	menu.stage = "off";
	io.stdout.write(`(已切到 ${agentPresetLabel(id)}，与桌面端共用。输入 4 开新会话后生效)\n`);
	return "continue";
}
function renderPermissionMenu(ctx, io, menu) {
	const service = ctx.get("permissionPresets");
	const names = service === void 0 ? [
		"read-only",
		"workspace-write",
		"danger-full-access"
	] : [...service.names];
	menu.permissionIds = names;
	menu.stage = "permission";
	const current = service?.defaultPreset ?? "danger-full-access";
	io.stdout.write("\n选择权限（与桌面端「通用设置 → 权限」同一项，新会话生效）：\n");
	names.forEach((name, index) => {
		const mark = name === current ? " *" : "";
		const option = service?.optionOf(name);
		io.stdout.write(`  ${index + 1}. ${option?.name ?? permissionLabel(name)} (${name})${mark}\n`);
		if (option?.description) io.stdout.write(`     ${option.description}\n`);
	});
	io.stdout.write("   0. 取消\n");
}
async function pickPermission(ctx, menu, input, io) {
	const trimmed = input.trim();
	if (trimmed === "" || trimmed === "0") {
		menu.stage = "off";
		io.stdout.write("(已取消)\n");
		return "continue";
	}
	const id = menu.permissionIds[Number(trimmed) - 1];
	if (id === void 0) {
		io.stdout.write(`(没有这个权限: ${trimmed})\n`);
		return "continue";
	}
	try {
		await ctx.get("settings")?.update(PERMISSION_NS, { defaultPreset: id });
	} catch (error) {
		io.stderr.write(`dsh: 未能写入权限: ${error instanceof Error ? error.message : String(error)}\n`);
		menu.stage = "off";
		return "continue";
	}
	menu.stage = "off";
	io.stdout.write(`(已切到 ${permissionLabel(id)}，与桌面端共用。输入 4 开新会话后生效)\n`);
	return "continue";
}
function pickArmorMode(menu, input, sessionId, model, io) {
	const trimmed = input.trim();
	if (trimmed === "" || trimmed === "0") {
		menu.stage = "off";
		io.stdout.write("(已取消)\n");
		return "continue";
	}
	const choice = ARMOR_CHOICES[Number(trimmed) - 1];
	if (!choice) {
		io.stdout.write(`(没有这个选项: ${trimmed})\n`);
		return "continue";
	}
	persistGlobalArmorMode(choice.mode);
	persistArmorSession(sessionId, choice.mode, model);
	menu.stage = "off";
	io.stdout.write(`(已切到 ${choice.label}，与桌面端共用。输入 4 开新会话后生效)\n`);
	return "continue";
}
function armorModeLabel(mode) {
	if (mode === "reverify") return "Reverify";
	if (mode === "pentagi") return "PentAGI";
	if (mode === "coldbrew") return "冷咖啡";
	return mode;
}
function skillInstallDir() {
	return join(String(process.env.DSH_HOME ?? "").trim() || join(homedir(), ".dsh"), "skills");
}
function skillSourceLabel(source) {
	if (source === "project-agents" || source === "project" || source.includes("workspace")) return "项目";
	if (source === "user" || source.includes("home") || source.includes("user")) return "本机";
	return "内置";
}
function skillOneLiner(description) {
	return clip(description.replace(/\s+/g, " ").trim().split(/[。.!?\n]/)[0] ?? "", 36);
}
function printSkillHelp(io) {
	const dest = skillInstallDir();
	io.stdout.write(`安装：把带 SKILL.md 的文件夹拷进 ${dest}\n或：/skill-install /绝对路径/技能目录\n`);
}
async function printSkillList(ctx, io, cwd) {
	const skills = ctx.get("skills");
	if (skills === void 0) {
		io.stdout.write("当前进程没有 skills 服务。\n");
		return;
	}
	const listed = await skills.list({ cwd });
	if (listed.length === 0) {
		io.stdout.write("目前没有已加载的技能。对话里直接说任务即可，不必先选技能。\n");
		printSkillHelp(io);
		return;
	}
	io.stdout.write(`技能 ${listed.length} 个（对话里直接说需求就会用，不必先点）：\n`);
	listed.forEach((skill, index) => {
		io.stdout.write(`  ${index + 1}. ${skill.name}  ${skillSourceLabel(String(skill.source))}  ${skillOneLiner(skill.description)}\n`);
	});
	printSkillHelp(io);
}
function installSkillFromPath(src, io) {
	const from = resolve(src);
	if (!existsSync(from)) {
		io.stdout.write(`路径不存在: ${from}\n`);
		return;
	}
	const destRoot = skillInstallDir();
	mkdirSync(destRoot, { recursive: true });
	const dest = join(destRoot, basename(from).replace(/\.md$/u, ""));
	cpSync(from, dest, { recursive: true });
	const marker = existsSync(join(dest, "SKILL.md")) || statSync(dest).isFile() && dest.endsWith(".md");
	io.stdout.write(marker ? `已安装到 ${dest}。下一轮对话会加载。输入「技能」再看列表。\n` : `已拷到 ${dest}，但没看到 SKILL.md。技能目录里需要有 SKILL.md。\n`);
}
function formatTokens(n) {
	if (n < 1e3) return String(n);
	if (n < 1e6) {
		const scaled = n / 1e3;
		return `${scaled >= 100 ? Math.round(scaled) : Math.round(scaled * 10) / 10}K`;
	}
	const scaled = n / 1e6;
	return `${scaled >= 100 ? Math.round(scaled) : Math.round(scaled * 10) / 10}M`;
}
function occupancyFromPressure(pressure) {
	const used = pressure?.projectedTokens ?? pressure?.pressureTokens;
	if (used === void 0 || pressure?.contextWindow === void 0) return void 0;
	return {
		percent: Math.min(100, Math.round(used / pressure.contextWindow * 100)),
		used,
		window: pressure.contextWindow
	};
}
function formatContextBar(ctx, session) {
	const pressure = ctx.get("sessionProjections")?.snapshot(session).values.contextPressure;
	const occupancy = occupancyFromPressure(pressure);
	if (occupancy === void 0) return "上下文: 等待模型上报容量";
	return `上下文: ${formatTokens(occupancy.used)} / ${formatTokens(occupancy.window)} · ${occupancy.percent}%`;
}
function manualCompactionMessage(error) {
	switch (error.code) {
		case "busy": return "压缩不可用：已有压缩在跑，或智能体不空闲。";
		case "cancelled": return "压缩已取消。";
		case "changed": return "要压缩的历史在提交前变了，会话未改。";
		case "summary": return "没能生成有用的摘要，会话未改。";
		case "commit": return "压缩没有干净结束，先检查当前会话再重试。";
		case "persistence": return "压缩完成，但会话没能保存。";
		default: return error.message;
	}
}
function formatGoalBar(goal) {
	if (goal === void 0) return void 0;
	return `${goal.phase === "active" ? "进行中的目标" : goal.phase === "paused" ? "已暂停的目标" : goal.phase === "blocked" ? "受阻的目标" : "已完成的目标"} · 第 ${goal.roundsStarted}/${goal.maxGoalRounds} 轮\n${clip(goal.objective, 100)}`;
}
function blocksText(content) {
	return content.filter((block) => block.type === "text" && typeof block.text === "string").map((block) => block.text).join("");
}
function eventText(event) {
	if (event.type === "user/message") return blocksText(event.data.content);
	if (event.type === "assistant/message") return blocksText(event.data.message.content);
	return "";
}
function printTrajectory(session, io) {
	const events = session.events;
	const turns = events.filter((event) => event.type === "turn/start").length;
	const tools = events.filter((event) => event.type === "tool/call").length;
	io.stdout.write(`轨迹  ${turns} 轮  ${tools} 次工具  ${events.length} 条事件\n`);
	let printed = 0;
	for (const event of events) if (event.type === "user/message") {
		io.stdout.write(`USER       ${clip(eventText(event), 120)}\n`);
		printed += 1;
	} else if (event.type === "tool/call") {
		io.stdout.write(`TOOL       ${event.data.name}  ${prettyArgs(event.data.arguments)}\n`);
		printed += 1;
	} else if (event.type === "tool/result") {
		const fail = event.data.error?.code;
		io.stdout.write(fail ? `TOOL-ERR    ${fail}\n` : "TOOL-OK\n");
		printed += 1;
	} else if (event.type === "assistant/message") {
		const text = eventText(event);
		if (text.trim() !== "") {
			io.stdout.write(`ASSISTANT  ${clip(text, 160)}\n`);
			printed += 1;
		}
	}
	if (printed === 0) io.stdout.write("还没有记录。先说一句话再打开轨迹。\n");
}
function clip(text, max = 240) {
	const one = text.replace(/\s+/g, " ").trim();
	return one.length <= max ? one : `${one.slice(0, max)}…`;
}
function prettyArgs(raw) {
	try {
		const parsed = JSON.parse(raw);
		if (parsed && typeof parsed === "object") {
			const record = parsed;
			const preferred = record.command ?? record.path ?? record.query ?? record.url ?? record.prompt;
			if (typeof preferred === "string" && preferred.trim() !== "") return clip(preferred, 100);
			return Object.entries(record).slice(0, 4).map(([key, value]) => {
				return `${key}=${typeof value === "string" ? clip(value, 60) : clip(JSON.stringify(value), 60)}`;
			}).join(" ");
		}
	} catch {}
	return clip(raw, 100);
}
function printLiveEvent(io, event, live) {
	if (event.type === "turn/start") {
		live.thinking = false;
		live.tools.clear();
		return;
	}
	if (event.type === "assistant/chunk") {
		if (event.data.chunk.type === "reasoning-delta" && !live.thinking) {
			live.thinking = true;
			io.stdout.write("· 思考中…\n");
		}
		return;
	}
	if (event.type === "assistant/message") {
		if (!live.thinking) {
			if (event.data.message.content.some((block) => block.type === "reasoning" && block.text.trim() !== "")) {
				live.thinking = true;
				io.stdout.write("· 思考中…\n");
			}
		}
		for (const block of event.data.message.content) {
			if (block.type !== "tool-call") continue;
			const id = String(block.id);
			if (live.tools.has(id)) continue;
			live.tools.add(id);
			io.stdout.write(`→ ${block.name}  ${prettyArgs(block.arguments)}\n`);
		}
		return;
	}
	if (event.type === "tool/call") {
		const id = String(event.data.callId);
		if (live.tools.has(id)) return;
		live.tools.add(id);
		io.stdout.write(`→ ${event.data.name}  ${prettyArgs(event.data.arguments)}\n`);
		return;
	}
	if (event.type === "tool/result") {
		const block = event.data.message.content[0];
		const preview = (block?.type === "tool-result" ? block.content : []).filter((part) => part.type === "text").map((part) => part.text).join("");
		const fail = event.data.error?.code ?? (block?.type === "tool-result" && block.isError ? "error" : void 0);
		io.stdout.write(fail ? `✓ 失败 ${fail}${preview ? `  ${clip(preview, 120)}` : ""}\n` : `✓ 完成${preview ? `  ${clip(preview, 120)}` : ""}\n`);
	}
}
function summarizeTurn(events, firstSeq) {
	let started = false;
	let text = "";
	let reason;
	for (const event of events) {
		if (event.seq < firstSeq) continue;
		if (event.type === "turn/start") {
			started = true;
			continue;
		}
		if (!started) continue;
		if (event.type === "assistant/message") {
			const joined = event.data.message.content.filter((block) => block.type === "text").map((block) => block.text).join("");
			if (joined !== "") text = joined;
		}
		if (event.type === "turn/end") reason = event.data.reason;
	}
	return {
		text,
		reason
	};
}
const IMAGE_MEDIA = {
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".webp": "image/webp",
	".gif": "image/gif"
};
function extractPathTokens(line) {
	const tokens = [];
	const quoted = /(?:"([^"]+)"|'([^']+)')/g;
	let match;
	while ((match = quoted.exec(line)) !== null) tokens.push(match[1] ?? match[2] ?? "");
	for (const raw of line.split(/\s+/)) {
		const token = raw.replace(/^['"]|['"]$/g, "");
		if (token.startsWith("/") || token.startsWith("~/") || /^[A-Za-z]:[\\/]/.test(token)) tokens.push(token);
	}
	return [...new Set(tokens.filter(Boolean))];
}
function resolveDroppedPath(token, cwd) {
	const expanded = token.startsWith("~/") ? join(homedir(), token.slice(2)) : token;
	const candidates = [expanded, isAbsolute(expanded) ? expanded : resolve(cwd, expanded)];
	for (const candidate of candidates) if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
}
async function composeUserContent(ctx, line, cwd, io) {
	const blocks = [];
	const notes = [];
	const attachments = ctx.get("attachments");
	for (const token of extractPathTokens(line)) {
		const path = resolveDroppedPath(token, cwd);
		if (path === void 0) continue;
		const mediaType = IMAGE_MEDIA[extname(path).toLowerCase()];
		if (mediaType !== void 0 && attachments !== void 0) try {
			const data = new Uint8Array(readFileSync(path));
			const attachment = await attachments.saveImage({
				data,
				mediaType,
				name: basename(path)
			});
			blocks.push({
				type: "image",
				attachment
			});
			io.stdout.write(`(已附加图片 ${basename(path)} ${attachment.width}×${attachment.height})\n`);
			continue;
		} catch (error) {
			io.stderr.write(`dsh: 图片 ${basename(path)} 未附加: ${error instanceof Error ? error.message : String(error)}\n`);
		}
		notes.push(path);
	}
	const text = notes.length === 0 ? line : `${line}\n\n附件路径:\n${notes.map((path) => `- ${path}`).join("\n")}`;
	if (text.trim() !== "" || blocks.length === 0) blocks.unshift({
		type: "text",
		text
	});
	return blocks;
}
async function runTurn(agent, sessions, line, cancel, content) {
	const firstSeq = agent.session.seq;
	agent.followup(createUserMessage({
		content: content ?? [{
			type: "text",
			text: line
		}],
		source: { kind: "user" }
	}));
	const idle = agent.whenIdle();
	const timer = cancel === void 0 ? void 0 : setTimeout(() => {
		cancel();
	}, TURN_TIMEOUT_MS);
	try {
		await idle;
	} finally {
		if (timer !== void 0) clearTimeout(timer);
	}
	await sessions.flush(agent.session);
	return summarizeTurn(agent.session.events, firstSeq);
}
/**
* One interactive session: create an agent, optionally run the initial task,
* then read-evaluate-print until `/quit`, `/exit`, `/new` or stdin EOF.
* @param ctx - plugin context carrying core services.
* @param config - validated boot config for THIS session.
* @param io - process-facing effects.
* @returns the reason the session ended.
*/
async function runSession(ctx, config, io) {
	await ctx.get("loader")?.await();
	const agents = ctx.get("agents");
	const defaultModel = ctx.get("agentDefaultModel");
	const sessions = ctx.get("sessions");
	if (agents === void 0 || defaultModel === void 0 || sessions === void 0) return "quit";
	const selection = defaultModel.currentSelection();
	const requested = String(config.sessionId ?? "").trim();
	const sessionId = SessionId(requested === "" ? `session-${randomUUID()}` : requested);
	const workspace = process.cwd();
	io.stdout.write(`(session ${sessionId})\n`);
	io.stdout.write(`(工作区 ${workspace})\n`);
	const provider = String(config.provider ?? "").trim() || selection.provider;
	const model = String(config.model ?? "").trim() || selection.model;
	const effective = config.provider || config.model ? {
		provider,
		model
	} : {
		...selection,
		provider,
		model
	};
	if (config.provider || config.model) io.stdout.write(`(model ${provider}/${model})\n`);
	const presets = ctx.get("agentPresets");
	const presetId = presets?.defaultId;
	const { agent } = await agents.create({
		sessionId,
		meta: {
			cwd: process.cwd(),
			...presetId === void 0 ? {} : { agentPreset: presetId }
		},
		agentOptions: effective ? {
			provider: effective.provider,
			model: effective.model
		} : {},
		setup: async (agentCtx) => {
			installModelSelection(agentCtx, {
				current: effective,
				assembled: void 0
			});
			if (presets !== void 0) await presets.mount(agentCtx, presetId);
		}
	});
	await agent.whenIdle();
	const armorId = String(agent.id);
	const live = {
		thinking: false,
		tools: /* @__PURE__ */ new Set()
	};
	ctx.on("session/event", (session, event) => {
		if (String(session.id) !== String(agent.session.id)) return;
		printLiveEvent(io, event, live);
	}, { global: true });
	const promptText = "\x1B[1mdsh>\x1B[0m ";
	const isTty = Boolean(io.stdin.isTTY);
	const rl = internals.createInterface({
		input: io.stdin,
		output: io.stdout,
		terminal: isTty,
		...isTty ? { prompt: promptText } : {}
	});
	const currentGoal = () => ctx.get("goals")?.get(agent);
	const printGoalBar = () => {
		const bar = formatGoalBar(currentGoal());
		if (bar) io.stdout.write(`${bar}\n`);
	};
	const printContextBar = () => {
		io.stdout.write(`${formatContextBar(ctx, agent.session)}\n`);
	};
	let replClosed = false;
	const prompt = () => {
		if (replClosed) return;
		printGoalBar();
		printContextBar();
		if (isTty) rl.prompt();
		else io.stdout.write(promptText);
	};
	const printCommandMenu = () => {
		const current = ctx.get("agentDefaultModel")?.currentSelection();
		const armor = readArmorSession(armorId);
		const globalMode = readGlobalArmorMode();
		const coldbrew = readDesktopSettings().coldbrew;
		const enabled = armor?.enabled ?? coldbrew?.defaultEnabled !== false;
		const mode = armor?.mode || globalMode;
		const armorLine = `破甲: ${enabled ? "已开" : "未开"} · ${armorModeLabel(mode)}（输入 8 切换，新会话生效）`;
		const presetLine = `Agent 预设: ${agentPresetLabel(ctx.get("agentPresets")?.defaultId ?? "standard")}（输入 10 切换）`;
		const permissionLine = `权限: ${permissionLabel(ctx.get("permissionPresets")?.defaultPreset ?? "danger-full-access")}（输入 11 切换）`;
		io.stdout.write(`
工作区: ${workspace}
${armorLine}
${presetLine}
${permissionLine}
（就是你敲 dsh 时所在的目录；cd 到项目再开 CLI。输入「工作区」再看一次。）
命令（数字、斜杠、或菜单上的中文名都可以）：
  1  /model     模型 / 选择模型 / 选模型     （当前: ${current?.provider}/${current?.model}${current?.reasoningEffort ? ` · ${effortLabel(String(current.reasoningEffort))}` : ""}）
  2  /config    配置 / 设置
  3  /help      帮助 / 菜单
  4  /new       新会话 / 开新会话
  5  /quit      退出
  6  /cwd       工作区
  7  /skills    技能
  8  /armor     工作模式 / 破甲
  9  /trace     轨迹
  10 /preset    Agent 预设
  11 /permission 权限
  12 /compact   压缩上下文
  13 /memory   记忆
直接打字回车就是对话。输入「帮助」或 3 再看本菜单。
整句「冷咖啡」只演口令（MAX 已开），不换内核。要换内核用菜单 8，再开新会话。
把图片/文件拖进终端，或把路径写在句子里，CLI 会当附件发出。
`);
	};
	if (config.initialTask && config.initialTask.trim() !== "") {
		const outcome = await runTurn(agent, sessions, config.initialTask);
		if (outcome.text !== "") io.stdout.write(outcome.text + "\n");
		if (outcome.reason?.kind === "error") io.stderr.write(`dsh: ${outcome.reason.error.code}: ${outcome.reason.error.message}\n`);
	}
	let busy = false;
	let pending;
	let pendingQueue = [];
	const menu = {
		stage: "off",
		providers: [],
		models: [],
		provider: "",
		efforts: [],
		reachable: /* @__PURE__ */ new Map(),
		presetIds: [],
		permissionIds: []
	};
	const configSummary = () => {
		const current = ctx.get("agentDefaultModel")?.currentSelection();
		const choices = enumerateModels(ctx);
		const pi = ctx.get("settings")?.get(LLM_PI_AI_NS);
		const providerCount = Object.keys(pi?.providers ?? {}).length;
		return [
			`工作区: ${workspace}`,
			`默认模型: ${current?.provider}/${current?.model}`,
			`接口商: ${providerCount + 1} 家（${[...Object.keys(pi?.providers ?? {}), "deepseek-official"].join(", ")}）`,
			`可选模型: ${choices.length} 个`,
			"模型和密钥跟桌面端共用：设置 → 模型。CLI 输入 1 选接口商再选模型。",
			"插件也在桌面端装（设置 → 插件），CLI 共用同一套配置。",
			`工作模式: ${armorModeLabel(readGlobalArmorMode())}（菜单 8 切换，与桌面端共用）`,
			`Agent 预设: ${agentPresetLabel(ctx.get("agentPresets")?.defaultId ?? "standard")}（菜单 10）`,
			`权限: ${permissionLabel(ctx.get("permissionPresets")?.defaultPreset ?? "danger-full-access")}（菜单 11）`,
			formatContextBar(ctx, agent.session),
			"长对话默认自动压缩（约满窗口 80%）。输入 12 或 /compact 可手动压一次。",
			"本地记忆: /memory list|search|add|forget（~/.dsh/tui-memory.json）",
			"手动改文件：~/.dsh/settings.yaml 、 ~/.dsh/.credentials.yaml",
			""
		].join("\n");
	};
	let done = () => {};
	const finished = new Promise((resolve) => {
		done = resolve;
	});
	process.removeAllListeners("SIGINT");
	let idleInterruptAt = 0;
	const onSigint = () => {
		if (busy) {
			idleInterruptAt = 0;
			agent.cancel({ kind: "user" });
			io.stdout.write("\n(已停止本轮 — 可继续输入。再按两次 Ctrl+C 退出)\n");
			prompt();
			return;
		}
		const now = Date.now();
		if (now - idleInterruptAt < 2e3) {
			done("quit");
			io.exit(130);
			return;
		}
		idleInterruptAt = now;
		try {
			if (isTty && !replClosed) rl.write(null, {
				ctrl: true,
				name: "u"
			});
		} catch {}
		io.stdout.write("\n(已清空输入。再按一次 Ctrl+C 退出，或继续打字)\n");
		prompt();
	};
	rl.on("SIGINT", onSigint);
	process.on("SIGINT", onSigint);
	printCommandMenu();
	prompt();
	rl.on("line", async (line) => {
		let trimmed = line.trim();
		if (menu.stage === "off") trimmed = {
			1: "/model",
			2: "/config",
			3: "/help",
			4: "/new",
			5: "/quit",
			6: "/cwd",
			7: "/skills",
			8: "/armor",
			9: "/trace",
			10: "/preset",
			11: "/permission",
			12: "/compact",
			13: "/memory",
			模型: "/model",
			选择模型: "/model",
			选模型: "/model",
			接口商: "/model",
			配置: "/config",
			设置: "/config",
			帮助: "/help",
			菜单: "/help",
			新会话: "/new",
			开新会话: "/new",
			退出: "/quit",
			工作区: "/cwd",
			技能: "/skills",
			破甲: "/armor",
			工作模式: "/armor",
			轨迹: "/trace",
			时间线: "/trace",
			预设: "/preset",
			Agent预设: "/preset",
			权限: "/permission",
			压缩: "/compact",
			压缩上下文: "/compact",
			记忆: "/memory"
		}[trimmed] ?? trimmed;
		if (menu.stage === "armor" && !trimmed.startsWith("/")) {
			if (pickArmorMode(menu, trimmed, armorId, model, io) === "new") if (busy) pending = "new";
			else done("new");
			else prompt();
			return;
		}
		if (menu.stage === "preset" && !trimmed.startsWith("/")) {
			await pickPreset(ctx, menu, trimmed, io);
			prompt();
			return;
		}
		if (menu.stage === "permission" && !trimmed.startsWith("/")) {
			await pickPermission(ctx, menu, trimmed, io);
			prompt();
			return;
		}
		if (menu.stage !== "off" && !trimmed.startsWith("/")) {
			if (await pickFromMenu(ctx, io, menu, trimmed) === "new") if (busy) pending = "new";
			else done("new");
			else prompt();
			return;
		}
		if (trimmed === "/quit" || trimmed === "/exit") {
			if (busy) {
				pending = "quit";
				return;
			}
			done("quit");
			return;
		}
		if (trimmed === "/new") {
			io.stdout.write("(正在开新会话)\n");
			if (busy) {
				pending = "new";
				return;
			}
			done("new");
			return;
		}
		if (trimmed === "/model") {
			if (menu.stage !== "off") {
				io.stdout.write("(菜单已经打开)\n");
				prompt();
				return;
			}
			renderProviderMenu(ctx, io, menu);
			if (busy) pending = "new";
			return;
		}
		if (trimmed === "/armor") {
			if (menu.stage !== "off") {
				io.stdout.write("(菜单已经打开)\n");
				prompt();
				return;
			}
			renderArmorMenu(io, menu);
			return;
		}
		if (trimmed === "/preset") {
			if (menu.stage !== "off") {
				io.stdout.write("(菜单已经打开)\n");
				prompt();
				return;
			}
			await renderPresetMenu(ctx, io, menu);
			prompt();
			return;
		}
		if (trimmed === "/permission") {
			if (menu.stage !== "off") {
				io.stdout.write("(菜单已经打开)\n");
				prompt();
				return;
			}
			renderPermissionMenu(ctx, io, menu);
			return;
		}
		if (trimmed === "/config") {
			io.stdout.write(configSummary() + "\n");
			prompt();
			return;
		}
		if (trimmed === "/cwd") {
			io.stdout.write(`工作区: ${workspace}\n`);
			prompt();
			return;
		}
		if (trimmed === "/goal-pause" || trimmed === "暂停目标") {
			const goal = currentGoal();
			if (goal === void 0) io.stdout.write("当前没有目标。\n");
			else try {
				ctx.get("goals")?.pause(agent, {
					id: goal.id,
					revision: goal.revision
				});
			} catch (error) {
				io.stderr.write(`dsh: ${error instanceof Error ? error.message : String(error)}\n`);
			}
			prompt();
			return;
		}
		if (trimmed === "/goal-clear" || trimmed === "清除目标") {
			const goal = currentGoal();
			if (goal === void 0) io.stdout.write("当前没有目标。\n");
			else try {
				ctx.get("goals")?.clear(agent, {
					id: goal.id,
					revision: goal.revision
				});
			} catch (error) {
				io.stderr.write(`dsh: ${error instanceof Error ? error.message : String(error)}\n`);
			}
			prompt();
			return;
		}
		if (trimmed === "/skills" || trimmed.startsWith("/skill-install ")) {
			if (trimmed.startsWith("/skill-install ")) installSkillFromPath(trimmed.slice(15).trim(), io);
			else await printSkillList(ctx, io, workspace);
			prompt();
			return;
		}
		if (trimmed === "/memory" || trimmed === "/memory list" || trimmed === "/memory forget" || trimmed.startsWith("/memory ")) {
			const memStore = loadMemory();
			if (trimmed === "/memory") {
				memoryList(memStore, io);
				prompt();
				return;
			}
			if (trimmed === "/memory list") {
				memoryList(memStore, io);
				prompt();
				return;
			}
			if (trimmed.startsWith("/memory search ")) {
				memorySearch(memStore, trimmed.replace("/memory search", ""), io);
				prompt();
				return;
			}
			if (trimmed.startsWith("/memory add ")) {
				memoryAdd(memStore, trimmed, io);
				prompt();
				return;
			}
			if (/^\/memory\s+(?:forget|delete)\s/.test(trimmed)) {
				memoryForget(memStore, trimmed, io);
				prompt();
				return;
			}
			io.stdout.write("(用法: /memory search|add|list|forget <参数>)\n");
			prompt();
			return;
		}
		if (pending !== void 0) return;
		if (trimmed === "/help") {
			printCommandMenu();
			prompt();
			return;
		}
		if (trimmed === "") {
			prompt();
			return;
		}
		const played = playArmorPhrase(trimmed);
		if (played !== null) {
			io.stdout.write(played + "\n");
			prompt();
			return;
		}
		if (busy) {
			io.stdout.write(`(已排入队列，当前 turn 结束后处理。队列 ${pendingQueue.length + 1} 条。Ctrl+C 取消)\n`);
			pendingQueue.push(trimmed);
			return;
		}
		if (trimmed === "/trace") {
			printTrajectory(agent.session, io);
			prompt();
			return;
		}
		if (trimmed === "/compact") {
			const compaction = ctx.get("compaction");
			if (compaction === void 0) {
				io.stdout.write("当前配置没有挂载压缩服务。\n");
				prompt();
				return;
			}
			busy = true;
			io.stdout.write("(正在压缩上下文…)\n");
			try {
				const result = await compaction.compactNow(agent, new AbortController().signal);
				if (result === null) io.stdout.write("还没有可压缩的历史。\n");
				else io.stdout.write(`已压缩 ${result.shadowedSeqs.length} 条历史（约 ${formatTokens(result.shadowedTokenCount)} tokens）。\n`);
			} catch (error) {
				if (error instanceof ManualCompactionError) io.stdout.write(`${manualCompactionMessage(error)}\n`);
				else io.stderr.write(`dsh: ${error instanceof Error ? error.message : String(error)}\n`);
			} finally {
				busy = false;
			}
			if (pending !== void 0) {
				done(pending);
				return;
			}
			prompt();
			return;
		}
		busy = true;
		io.stdout.write("(正在处理… Ctrl+C 取消)\n");
		try {
			const content = await composeUserContent(ctx, trimmed, workspace, io);
			const outcome = await runTurn(agent, sessions, trimmed, () => {
				agent.cancel({ kind: "user" });
			}, content);
			if (outcome.text !== "") io.stdout.write(outcome.text + "\n");
			if (outcome.reason?.kind === "error") io.stderr.write(`dsh: ${outcome.reason.error.code}: ${outcome.reason.error.message}\n`);
			else if (outcome.reason?.kind === "aborted") io.stderr.write("dsh: 本轮超时或已取消（接口可能不可达，换个模型试试）\n");
			while (pending === void 0) {
				const goal = currentGoal();
				if (goal === void 0 || goal.phase !== "active" || goal.activation !== "armed") break;
				io.stdout.write(`${formatGoalBar(goal)}\n(目标续跑中… Ctrl+C 取消 / 暂停目标)\n`);
				const seqBefore = agent.session.seq;
				await new Promise((resolveWait) => {
					const stop = ctx.on("agent/status", ({ agent: subject, status }) => {
						if (subject !== agent || status !== "idle") return;
						stop();
						resolveWait();
					}, { global: true });
					if (agent.status === "idle") {
						const again = currentGoal();
						if (again === void 0 || again.phase !== "active" || again.activation !== "armed") {
							stop();
							resolveWait();
						}
					}
				});
				await sessions.flush(agent.session);
				const later = summarizeTurn(agent.session.events, seqBefore);
				if (later.text !== "") io.stdout.write(later.text + "\n");
			}
		} catch (error) {
			io.stderr.write(`dsh: turn failed: ${error instanceof Error ? error.message : String(error)}\n`);
		} finally {
			while (pending === void 0 && pendingQueue.length > 0) {
				const nextLine = pendingQueue.shift();
				if (!nextLine) continue;
				io.stdout.write(`(队列 turn: ${clip(nextLine, 60)})\n`);
				try {
					io.stdout.write("(正在处理… Ctrl+C 取消)\n");
					const outcome = await runTurn(agent, sessions, nextLine, () => {
						agent.cancel({ kind: "user" });
					}, await composeUserContent(ctx, nextLine, workspace, io));
					if (outcome.text !== "") io.stdout.write(outcome.text + "\n");
					if (outcome.reason?.kind === "error") io.stderr.write(`dsh: ${outcome.reason.error.code}: ${outcome.reason.error.message}\n`);
				} catch (error) {
					io.stderr.write(`dsh: queued turn failed: ${error instanceof Error ? error.message : String(error)}\n`);
				}
			}
			busy = false;
			if (pending !== void 0) {
				done(pending);
				return;
			}
			if (replClosed) {
				done("eof");
				return;
			}
			prompt();
		}
	});
	rl.on("close", () => {
		replClosed = true;
		if (!busy && pendingQueue.length === 0 && idleInterruptAt === 0) done(pending ?? "eof");
	});
	try {
		return await finished;
	} finally {
		rl.close();
	}
}
/** Report an unexpected direct-driver failure and request a failing exit. */
function fail(io, error) {
	io.stderr.write(`dsh: ${error instanceof Error ? error.message : String(error)}\n`);
	io.exit(1);
}
/**
* Print the loaded plugin inventory (loader entries with activation status)
* and the registered tool list, then request exit.
* @param ctx - settled plugin context.
* @param io - process-facing effects.
*/
function runCheck(ctx, io) {
	const loader = ctx.get("loader");
	const tools = ctx.get("tools");
	const selection = ctx.get("agentDefaultModel")?.currentSelection();
	io.stdout.write(`model: ${selection?.provider}/${selection?.model}\n`);
	io.stdout.write(`tools (registered): ${tools?.schemas().length ?? 0}\n`);
	let activated = 0;
	let pending = 0;
	let disabled = 0;
	if (loader !== void 0) {
		io.stdout.write("\nplugins:\n");
		for (const entry of loader.entries()) {
			const status = entry.disabled ? "disabled" : entry.fiber !== void 0 ? "active" : "pending";
			if (status === "active") activated += 1;
			else if (status === "pending") pending += 1;
			else disabled += 1;
			io.stdout.write(`  ${status.padEnd(8)} ${entry.id}`);
			if (entry.options.name !== void 0 && entry.options.name !== entry.id) io.stdout.write(`  (${entry.options.name})`);
			io.stdout.write("\n");
		}
		io.stdout.write(`\nactivated ${activated}, pending ${pending}, disabled ${disabled}\n`);
	}
	if (tools !== void 0) {
		io.stdout.write("\nregistered tools:\n");
		for (const tool of tools.schemas()) io.stdout.write(`  ${tool.name}\n`);
	}
	io.exit(0);
}
/**
* Drive the REPL until the user quits; `/new` relaunches a fresh session.
* @param ctx - plugin context carrying core services and the launcher-provided exit request.
* @param config - validated boot config (sessionId reused only for the first session).
* @param io - process-facing effects.
*/
function apply(ctx, config) {
	const exit = ctx.get("appExit");
	if (exit === void 0) throw new Error("tui-runner: the launcher must provide ctx.appExit before the tree mounts");
	const io = {
		stdout: internals.stdout,
		stderr: internals.stderr,
		stdin: internals.stdin,
		exit
	};
	if (config.check === true) {
		(async () => {
			await ctx.get("loader")?.await();
			runCheck(ctx, io);
		})().catch((error) => {
			fail(io, error);
		});
		return;
	}
	const drive = async () => {
		let sessionConfig = config;
		for (;;) {
			const reason = await runSession(ctx, sessionConfig, io);
			if (reason === "new") {
				sessionConfig = {
					sessionId: "",
					initialTask: "",
					provider: String(config.provider ?? ""),
					model: String(config.model ?? "")
				};
				continue;
			}
			io.exit(reason === "quit" ? 0 : 0);
			return;
		}
	};
	drive().catch((error) => {
		fail(io, error);
	});
}
//#endregion
export { Config, apply, inject, internals, name };
