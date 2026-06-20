export function formatHelpText(): string {
  return [
    'piscord - Lightweight Discord gateway for pi coding agent',
    '',
    'USAGE:',
    '  piscord setup [token]                         Interactive setup wizard',
    '  piscord start                                 Start the gateway in the foreground',
    '  piscord status                                Show local diagnostics',
    '  piscord archive list                          List archived sessions',
    '  piscord archive cleanup [--dry-run]           Clean up archived sessions now',
    '  piscord task add --name <n> --schedule <expr> --channel <jid> --prompt <text> [--once]',
    '  piscord task list                             List scheduled tasks',
    '  piscord task remove <id>                      Remove a scheduled task',
    '  piscord task enable <id>                      Enable a scheduled task',
    '  piscord task disable <id>                     Disable a scheduled task',
    '  piscord channels                              List registered channels',
    '  piscord send --channel <jid> [--text <message>] [--reply-to <message-id>] [--file <path> ...]',
    '  piscord register <id> <name> [opts]          Register a Discord channel',
    '  piscord unregister <id>                       Unregister a channel',
    '  piscord daemon install                        Install systemd user service',
    '  piscord daemon uninstall                      Remove systemd user service',
    '  piscord daemon start                          Start systemd service',
    '  piscord daemon stop                           Stop systemd service',
    '  piscord daemon status                         Show systemd service status',
    '  piscord daemon logs                           Tail systemd journal logs',
    '  piscord help                                  Show this help',
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
