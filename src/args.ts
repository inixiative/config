import { type ParseArgsConfig, parseArgs } from 'node:util';
import { isLane, type Lane, type Preset } from './lib';

export const COMMANDS = ['check', 'sync', 'scan', 'train', 'ports'] as const;
export type Command = (typeof COMMANDS)[number];

const PRESETS: readonly Preset[] = ['base', 'node', 'react'];

const preset = { type: 'string' } as const;
const lane = { type: 'string' } as const;
const flag = { type: 'boolean', default: false } as const;

/** Each command accepts only its own flags; anything else is a usage error, never ignored. */
const OPTIONS = {
  check: { preset },
  sync: { preset, force: flag, 'no-install': flag },
  scan: { lane },
  train: { lane, push: flag, 'dry-run': flag },
  ports: {},
} as const;

export type CommandLine = {
  command: Command;
  positionals: string[];
  preset?: Preset;
  lane?: Lane;
  force: boolean;
  noInstall: boolean;
  push: boolean;
  dryRun: boolean;
};

export class UsageError extends Error {}

const isCommand = (value: string | undefined): value is Command =>
  COMMANDS.includes(value as Command);

export const parseCommandLine = (argv: string[]): CommandLine => {
  const command = argv[0];
  if (!isCommand(command)) throw new UsageError(`unknown command: ${command ?? '(none)'}`);
  let values: Record<string, unknown>;
  let positionals: string[];
  let tokens: { kind: string; name?: string }[];
  try {
    const options: ParseArgsConfig['options'] = OPTIONS[command];
    ({ values, positionals, tokens } = parseArgs({
      args: argv.slice(1),
      options,
      allowPositionals: true,
      strict: true,
      tokens: true,
    }));
  } catch (error) {
    throw new UsageError(`${command}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (positionals.length > 1)
    throw new UsageError(
      `${command}: unexpected argument ${positionals[1]} — did you mean --${positionals[1]}?`,
    );
  const names = tokens.flatMap((token) =>
    token.kind === 'option' && token.name ? [token.name] : [],
  );
  const repeated = names.find((name, index) => names.indexOf(name) !== index);
  if (repeated) throw new UsageError(`${command}: --${repeated} given more than once`);
  const presetValue = values.preset;
  if (typeof presetValue === 'string' && !PRESETS.includes(presetValue as Preset)) {
    throw new UsageError(`unknown preset: ${presetValue}`);
  }
  const laneValue = values.lane;
  if (typeof laneValue === 'string' && !isLane(laneValue)) {
    throw new UsageError(`unknown lane: ${laneValue}`);
  }
  return {
    command,
    positionals,
    preset: typeof presetValue === 'string' ? (presetValue as Preset) : undefined,
    lane: typeof laneValue === 'string' && isLane(laneValue) ? laneValue : undefined,
    force: values.force === true,
    noInstall: values['no-install'] === true,
    push: values.push === true,
    dryRun: values['dry-run'] === true,
  };
};
