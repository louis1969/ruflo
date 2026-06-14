import { Command } from 'commander';
import { runWizard } from './wizard.js';

export function initCommand(): Command {
  const cmd = new Command('init');

  cmd
    .description('Initialize a new Ruflo project')
    .argument('[mode]', 'Init mode: wizard (default)', 'wizard')
    .option('-d, --dir <path>', 'Target directory', process.cwd())
    .action(async (mode: string, opts: { dir: string }) => {
      if (mode !== 'wizard') {
        console.error(`Unknown init mode: ${mode}. Available: wizard`);
        process.exit(1);
      }
      await runWizard(opts.dir);
    });

  return cmd;
}
