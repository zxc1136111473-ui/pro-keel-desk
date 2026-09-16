/**
 * The interactive TUI app's command-line provider: it parses optional flags
 * (no task positional — the conversation is the command line), then publishes
 * {@link TUI_STARTUP_SERVICE}. The runner is an ordinary consumer whose lazy
 * config waits for that service.
 * @module @deepseek-ai/dsh-tui/startup
 */
import { Command } from 'commander';
import { parseCmdline } from '@deepseek-ai/dsh-cmdline';
/** Stable Cordis plugin name. */
export const name = 'tui-startup';
/** Services required before the run can resolve. */
export const inject = ['cmdlineArgs'];
/** Service provided by this plugin and injected by the interactive runner. */
export const TUI_STARTUP_SERVICE = 'tuiStartup';
/** Parse flags and return the boot values. */
function parseFlags(program) {
    return {
        sessionId: program.getOptionValue('session') ?? '',
        initialTask: program.getOptionValue('task') ?? '',
        provider: program.getOptionValue('provider') ?? '',
        model: program.getOptionValue('model') ?? '',
        check: program.getOptionValue('check') === true,
    };
}
/**
 * This app's command: interactive session flags, its description, and its
 * help text. No task positional: the REPL prompt is the conversation driver.
 * @returns a fresh program, so one process can parse more than once (tests).
 */
function tuiCommand() {
    return new Command()
        .name('dsh --profile tui')
        .description('启动交互式终端对话；看到 dsh> 后打字，/quit 退出。')
        .helpOption('-h, --help', '显示帮助')
        .option('--session <id>', '会话 id（续用或新建）')
        .option('-e, --task <task>', '启动后先跑一条任务，再进入对话')
        .option('--provider <name>', '指定接口商（空则用默认）')
        .option('--model <id>', '指定模型（空则用默认）')
        .option('--check', '打印已加载插件和工具后退出')
        .addHelpText('after', `
进入 dsh> 后的命令（数字、斜杠、中文名都行）：
  1 /model     模型 / 选择模型
  2 /config    配置 / 设置
  3 /help      帮助 / 菜单
  4 /new       新会话
  5 /quit      退出
  6 /cwd       工作区
  7 /skills    技能
  8 /armor     工作模式 / 破甲
  9 /trace     轨迹
  10 /preset    Agent 预设
  11 /permission 权限
  12 /compact   压缩上下文
  13 /memory    记忆
示例：
  dsh                                        直接进入交互菜单
  dsh tui                                    同上
  dsh --profile tui -e "recon the target"    先跑一条任务再对话
  dsh --profile tui --check                  检查插件/工具后退出
`);
}
/**
 * Parse and provide the interactive boot values as an ordinary Cordis
 * service. There is no required positional: a bare `dsh --profile tui`
 * starts the REPL with an empty first prompt.
 * @param ctx - plugin context carrying the command line.
 */
export function apply(ctx) {
    const program = tuiCommand();
    program.action(() => {
        ctx.provide(TUI_STARTUP_SERVICE, parseFlags(program));
    });
    parseCmdline(ctx, program);
}
//# sourceMappingURL=startup.js.map