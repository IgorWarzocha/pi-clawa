#!/usr/bin/env node

import { reportError } from './errors.js';
import { formatHelpText, printHelp } from './help.js';
import { isDirectExecution, maybeRunFirstTimeSetup } from './startup.js';

export { formatHelpText };

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  const [command] = argv;

  switch (command) {
    case undefined:
      printHelp();
      return 0;
    case 'start': {
      if (await maybeRunFirstTimeSetup()) return 0;
      const { startGateway } = await import('../index.js');
      await startGateway();
      return 0;
    }
    case 'help':
    case '--help':
    case '-h':
      printHelp();
      return 0;
    default:
      console.error(`Unknown command: ${command}\n`);
      printHelp();
      return 1;
  }
}

export async function runCli(argv: string[] = process.argv.slice(2)): Promise<void> {
  const command = argv[0];

  try {
    process.exitCode = await main(argv);
  } catch (err) {
    await reportError(command, err);
    process.exitCode = 1;
  }
}

if (isDirectExecution(import.meta.url)) {
  void runCli();
}
