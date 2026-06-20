#!/usr/bin/env node

import { cliArchive } from './archive.js';
import { cliListChannels, cliRegister, cliUnregister } from './channels.js';
import { reportError } from './errors.js';
import { formatHelpText, printHelp } from './help.js';
import { cliSend } from './send.js';
import { isDirectExecution, maybeRunFirstTimeSetup } from './startup.js';
import { cliTask } from './tasks.js';

export { formatHelpText };

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  const [command, ...args] = argv;

  switch (command) {
    case undefined:
      printHelp();
      return 0;
    case 'setup': {
      const { runSetup } = await import('./setup.js');
      await runSetup(args);
      return 0;
    }
    case 'start': {
      if (await maybeRunFirstTimeSetup()) return 0;
      const { startGateway } = await import('../index.js');
      await startGateway();
      return 0;
    }
    case 'status': {
      const { runStatus } = await import('./status.js');
      runStatus();
      return 0;
    }
    case 'archive':
      await cliArchive(args);
      return 0;
    case 'task':
      await cliTask(args);
      return 0;
    case 'channels':
      await cliListChannels();
      return 0;
    case 'send':
      await cliSend(args);
      return 0;
    case 'register':
      await cliRegister(args);
      return 0;
    case 'unregister':
      await cliUnregister(args);
      return 0;
    case 'daemon': {
      if (!args[0]) {
        throw new Error('Usage: pi-clawa-discord daemon <install|uninstall|start|stop|status|logs>');
      }

      const { runDaemon } = await import('./daemon.js');
      runDaemon(args[0]);
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
