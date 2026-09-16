/**
 * The interactive TUI app's command-line provider: it parses optional flags
 * (no task positional — the conversation is the command line), then publishes
 * {@link TUI_STARTUP_SERVICE}. The runner is an ordinary consumer whose lazy
 * config waits for that service.
 * @module @deepseek-ai/dsh-tui/startup
 */
import type { Context } from '@deepseek-ai/cordis';
/** Stable Cordis plugin name. */
export declare const name = "tui-startup";
/** Services required before the run can resolve. */
export declare const inject: string[];
/** Service provided by this plugin and injected by the interactive runner. */
export declare const TUI_STARTUP_SERVICE = "tuiStartup";
/** What the runner row reads from {@link TUI_STARTUP_SERVICE}. */
export interface TuiStartupValues {
    /** Stable session id to resume; empty string for a fresh random session. */
    sessionId: string;
    /** First task submitted immediately after boot before the REPL prompt; empty when absent. */
    initialTask: string;
    /** Provider override; empty keeps the settings default. */
    provider: string;
    /** Model override; empty keeps the settings default. */
    model: string;
    /** Print loaded plugin/tool inventory and exit without entering the REPL. */
    check: boolean;
}
/**
 * Parse and provide the interactive boot values as an ordinary Cordis
 * service. There is no required positional: a bare `dsh --profile tui`
 * starts the REPL with an empty first prompt.
 * @param ctx - plugin context carrying the command line.
 */
export declare function apply(ctx: Context): void;
//# sourceMappingURL=startup.d.ts.map