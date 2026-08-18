import * as path from 'node:path';

export interface AgyLaunchSpec {
  readonly args: string[];
  readonly command: string;
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
}

export interface AgyLaunchInputs {
  readonly cliPath: string;
  readonly prompt: string;
  readonly vaultWorkingDirectory: string;
  readonly externalWorkspaceRoots?: readonly string[];
  readonly model?: string;
  /** agy --effort: low | medium | high. */
  readonly reasoning?: string;
  /** agy --mode: accept-edits | plan. Omitted for agy's default. */
  readonly mode?: string;
  readonly skipPermissions: boolean;
  readonly conversationId?: string;
  readonly printTimeout?: string;
  readonly env: NodeJS.ProcessEnv;
}

const DEFAULT_PRINT_TIMEOUT = '10m';

/**
 * Builds one agy print-mode invocation.
 *
 * Print mode has no interactive channel, so a permission request is auto-denied
 * by agy and surfaces as a failed tool step. Every mode that writes therefore
 * requires `skipPermissions` or an `accept-edits` mode; the caller owns that
 * policy decision and this builder only records it.
 */
export function buildAgyLaunchSpec(inputs: AgyLaunchInputs): AgyLaunchSpec {
  const args = [
    '--print',
    inputs.prompt,
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
  if (inputs.reasoning) {
    args.push('--effort', inputs.reasoning);
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

  return {
    args,
    command: inputs.cliPath,
    cwd: inputs.vaultWorkingDirectory,
    env: inputs.env,
  };
}
