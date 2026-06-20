export function formatHelpText(): string {
  return [
    'pi-claw-discord - Lightweight Discord gateway for pi coding agent',
    '',
    'USAGE:',
    '  pi-claw-discord setup [token]                         Interactive setup wizard',
    '  pi-claw-discord start                                 Start the gateway in the foreground',
    '  pi-claw-discord status                                Show local diagnostics',
    '  pi-claw-discord archive list                          List archived sessions',
    '  pi-claw-discord archive cleanup [--dry-run]           Clean up archived sessions now',
    '  pi-claw-discord task add --name <n> --schedule <expr> --channel <jid> --prompt <text> [--once]',
    '  pi-claw-discord task list                             List scheduled tasks',
    '  pi-claw-discord task remove <id>                      Remove a scheduled task',
    '  pi-claw-discord task enable <id>                      Enable a scheduled task',
    '  pi-claw-discord task disable <id>                     Disable a scheduled task',
    '  pi-claw-discord channels                              List registered channels',
    '  pi-claw-discord send --channel <jid> [--text <message>] [--reply-to <message-id>] [--file <path> ...]',
    '  pi-claw-discord register <id> <name> [opts]          Register a Discord channel',
    '  pi-claw-discord unregister <id>                       Unregister a channel',
    '  pi-claw-discord daemon install                        Install systemd user service',
    '  pi-claw-discord daemon uninstall                      Remove systemd user service',
    '  pi-claw-discord daemon start                          Start systemd service',
    '  pi-claw-discord daemon stop                           Stop systemd service',
    '  pi-claw-discord daemon status                         Show systemd service status',
    '  pi-claw-discord daemon logs                           Tail systemd journal logs',
    '  pi-claw-discord help                                  Show this help',
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
