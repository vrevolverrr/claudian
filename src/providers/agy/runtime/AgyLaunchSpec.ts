import * as path from 'node:path';

export interface AgyLaunchSpec {
  readonly args: string[];
  readonly command: string;
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
}

export interface AgyLaunchInputs {
  readonly cliPath: string;
  readonly vaultWorkingDirectory: string;
  readonly externalWorkspaceRoots?: readonly string[];
  /** Raw agy model id, already decoded from the Claudian selection id. */
  readonly model?: string;
  /** agy --mode: accept-edits | plan. Omitted for agy's default. */
  readonly mode?: string;
  readonly skipPermissions: boolean;
  readonly conversationId?: string;
  readonly printTimeout?: string;
  readonly env: NodeJS.ProcessEnv;
}

const DEFAULT_PRINT_TIMEOUT = '10m';

/**
 * Builds one agy invocation that reads its turns from stdin.
 *
 * `--input-format stream-json` runs one turn per NDJSON line, so a single
 * process serves the whole session and pays agy's language-server boot and
 * `loadCodeAssist` chain once rather than once per turn. Reading the prompt
 * from stdin also removes the argument-size ceiling entirely.
 *
 * `--print` takes a value, so it is passed as `--print=` and kept last: given
 * a bare `--print`, agy swallows the following flag as the prompt.
 *
 * Print mode has no interactive channel, so a permission request is auto-denied
 * by agy and surfaces as a failed tool step. Every mode that writes therefore
 * requires `skipPermissions` or an `accept-edits` mode; the caller owns that
 * policy decision and this builder only records it.
 *
 * No `--effort` is ever passed: agy encodes reasoning effort in the model id
 * and rejects the flag outright for a model that already names its effort.
 */
export function buildAgyLaunchSpec(inputs: AgyLaunchInputs): AgyLaunchSpec {
  const args = [
    '--input-format',
    'stream-json',
    '--output-format',
    'stream-json',
    '--print-timeout',
    inputs.printTimeout ?? DEFAULT_PRINT_TIMEOUT,
  ];

  if (inputs.skipPermissions) {
    args.push('--dangerously-skip-permissions');
  }
  if (inputs.mode) {
    args.push('--mode', inputs.mode);
  }
  if (inputs.model) {
    args.push('--model', inputs.model);
  }
  if (inputs.conversationId) {
    args.push('--conversation', inputs.conversationId);
  }

  const seen = new Set<string>();
  for (const root of [inputs.vaultWorkingDirectory, ...(inputs.externalWorkspaceRoots ?? [])]) {
    const resolved = path.resolve(root);
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    args.push('--add-dir', resolved);
  }

  args.push('--print=');

  return {
    args,
    command: inputs.cliPath,
    cwd: inputs.vaultWorkingDirectory,
    env: inputs.env,
  };
}
