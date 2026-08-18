import type { ProviderManagedSubagentAdapter } from '../../core/providers/types';
import { TOOL_SUBAGENT } from '../../core/tools/toolNames';

/**
 * agy reports a delegation and nothing else: the subagent runs in its own agy
 * conversation whose steps never reach the parent stream, so there is no output
 * tool to hide and no nested transcript to attach.
 */
export const agySubagentAdapter: ProviderManagedSubagentAdapter = {
  protocol: 'managed-agent',
  isOutputTool() {
    return false;
  },
  isSpawnTool(name) {
    return name === TOOL_SUBAGENT;
  },
};
