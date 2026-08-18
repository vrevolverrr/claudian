import {
  TOOL_BASH,
  TOOL_EDIT,
  TOOL_GLOB,
  TOOL_GREP,
  TOOL_LS,
  TOOL_NOTEBOOK_EDIT,
  TOOL_READ,
  TOOL_SUBAGENT,
  TOOL_WEB_FETCH,
  TOOL_WEB_SEARCH,
  TOOL_WRITE,
} from '../../../core/tools/toolNames';

/**
 * agy tool identity -> Claudian tool identity.
 *
 * Names are mapped so the existing renderers and icons apply. agy's
 * `ask_question` is absent on purpose: print mode discards it before it reaches
 * the stream, so nothing would ever carry that name. Parameter keys
 * are only rewritten where the agy key has been observed on the wire; every
 * other key is passed through untouched, so an unmapped parameter degrades to
 * a generic tool-call render instead of a wrong one.
 */
const TOOL_NAME_MAP: Readonly<Record<string, string>> = Object.freeze({
  find_by_name: TOOL_GLOB,
  grep_search: TOOL_GREP,
  invoke_subagent: TOOL_SUBAGENT,
  list_dir: TOOL_LS,
  multi_replace_file_content: TOOL_EDIT,
  notebook_edit: TOOL_NOTEBOOK_EDIT,
  read_url_content: TOOL_WEB_FETCH,
  replace_file_content: TOOL_EDIT,
  run_command: TOOL_BASH,
  search_web: TOOL_WEB_SEARCH,
  sed_file: TOOL_EDIT,
  view_file: TOOL_READ,
  write_to_file: TOOL_WRITE,
});

/**
 * Observed agy parameter keys, per tool, and their Claudian equivalents.
 *
 * Only keys seen on a real agy stream are listed. Add a row after observing
 * the tool run — never from guessing the schema.
 */
const PARAMETER_KEY_MAP: Readonly<Record<string, Readonly<Record<string, string>>>> = Object.freeze({
  grep_search: { Query: 'pattern', SearchPath: 'path' },
  list_dir: { DirectoryPath: 'path' },
  replace_file_content: { TargetFile: 'file_path' },
  run_command: { CommandLine: 'command' },
  view_file: { AbsolutePath: 'file_path' },
  write_to_file: { TargetFile: 'file_path' },
});

export function normalizeAgyToolName(agyToolName: string): string {
  return TOOL_NAME_MAP[agyToolName] ?? agyToolName;
}

export function normalizeAgyToolInput(
  agyToolName: string,
  parameters: Readonly<Record<string, unknown>> | undefined,
): Record<string, unknown> {
  if (!parameters) return {};

  const keyMap = PARAMETER_KEY_MAP[agyToolName];
  if (!keyMap) return { ...parameters };

  const normalized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(parameters)) {
    normalized[keyMap[key] ?? key] = value;
  }
  return normalized;
}
