export function formatHelpText(): string {
  return [
    'pi-clawa-discord - Lightweight Discord gateway for pi coding agent',
    '',
    'USAGE:',
    '  pi-clawa-discord setup [token]                         Interactive setup wizard',
    '  pi-clawa-discord start                                 Start the gateway in the foreground',
    '  pi-clawa-discord status                                Show local diagnostics',
    '  pi-clawa-discord archive list                          List archived sessions',
    '  pi-clawa-discord archive cleanup [--dry-run]           Clean up archived sessions now',
    '  pi-clawa-discord task add --name <n> --schedule <expr> --channel <jid> --prompt <text> [--once]',
    '  pi-clawa-discord task list                             List scheduled tasks',
    '  pi-clawa-discord task remove <id>                      Remove a scheduled task',
    '  pi-clawa-discord task enable <id>                      Enable a scheduled task',
    '  pi-clawa-discord task disable <id>                     Disable a scheduled task',
    '  pi-clawa-discord channels                              List registered channels',
    '  pi-clawa-discord send --channel <jid> [--text <message>] [--reply-to <message-id>] [--file <path> ...]',
    '  pi-clawa-discord register <id> <name> [opts]          Register a Discord channel',
    '  pi-clawa-discord unregister <id>                       Unregister a channel',
    '  pi-clawa-discord daemon install                        Install systemd user service',
    '  pi-clawa-discord daemon uninstall                      Remove systemd user service',
    '  pi-clawa-discord daemon start                          Start systemd service',
    '  pi-clawa-discord daemon stop                           Stop systemd service',
    '  pi-clawa-discord daemon status                         Show systemd service status',
    '  pi-clawa-discord daemon logs                           Tail systemd journal logs',
    '  pi-clawa-discord help                                  Show this help',
    '',
    'REGISTER OPTIONS:',
    '  --folder <name>    Relative session folder name (default: ch_<id>)',
    '  --cwd <path>       Override PI_CWD for this channel only',
    '  --no-trigger       Respond to all messages (not just @mentions)',
    '  --main             Mark as main channel (implies --no-trigger)',
    '',
    'TASK OPTIONS:',
    '  --once             Treat --schedule as a one-time ISO datetime',
  ].join('\n');
}

export function printHelp(): void {
  console.log(formatHelpText());
}
