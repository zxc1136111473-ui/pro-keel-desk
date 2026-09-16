/**
 * @deepseek-ai/dsh-tui — interactive REPL runner. Creates one persistent Agent
 * through the core registry, accepts user lines from stdin, submits each as
 * a follow-up turn, and prints the final assistant text after quiescence.
 * `/new` resets to a fresh session; `/quit` requests process exit.
 *
 * @module @deepseek-ai/dsh-tui
 */
import type { Interface, ReadLineOptions } from 'node:readline';
import type { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
/** Stable Cordis plugin name. */
export declare const name = "tui-runner";
/** Core services required before the REPL loop can start. */
export declare const inject: string[];
/** Plugin config: boot values resolved from this app's injected provider service. */
export interface Config {
    /** Stable session id; fresh random when absent. */
    sessionId?: string;
    /** Optional initial task submitted before the REPL prompt. */
    initialTask?: string;
    /** Provider route override; empty keeps the settings default. */
    provider?: string;
    /** Model id override; empty keeps the settings default. */
    model?: string;
    /** Print the loaded plugin/tool inventory and exit without entering the REPL. */
    check?: boolean;
}
export declare const Config: z<Config>;
/** Why one REPL session ended. */
export type ReplExitReason = 'quit' | 'new' | 'eof';
/** Process-facing effects of one run: output streams plus the launcher's bounded exit request. */
interface TuiIo {
    stdout: {
        write(chunk: string): unknown;
    };
    stderr: {
        write(chunk: string): unknown;
    };
    stdin: NodeJS.ReadableStream;
    /** Request process exit with `code` after the tree disposes. */
    exit(code: number): void;
}
/** Process streams the runner writes to; tests substitute captures. */
export declare const internals: {
    stdout: TuiIo['stdout'];
    stderr: TuiIo['stderr'];
    stdin: TuiIo['stdin'];
    createInterface: (options: ReadLineOptions) => Interface;
};
/**
 * Drive the REPL until the user quits; `/new` relaunches a fresh session.
 * @param ctx - plugin context carrying core services and the launcher-provided exit request.
 * @param config - validated boot config (sessionId reused only for the first session).
 * @param io - process-facing effects.
 */
export declare function apply(ctx: Context, config: Config): void;
export {};
//# sourceMappingURL=index.d.ts.map