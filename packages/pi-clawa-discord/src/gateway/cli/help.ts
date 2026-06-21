export function formatHelpText(): string {
  return [
    'pi-clawa-discord - Clawa Discord gateway internals',
    '',
    'USAGE:',
    '  pi-clawa-discord start   Start the gateway in the foreground',
    '  pi-clawa-discord help    Show this help',
  ].join('\n');
}

export function printHelp(): void {
  console.log(formatHelpText());
}
