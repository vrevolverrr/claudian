import type {
  ProviderExecutionBackend,
  ProviderExecutionSession,
  ProviderSessionConfig,
} from '../../../core/execution';
import type { ProviderHost } from '../../../core/providers/ProviderHost';
import { AgyExecutionSession } from './AgyExecutionSession';

export class AgyExecutionBackend implements ProviderExecutionBackend {
  readonly providerId = 'agy' as const;

  constructor(private readonly host: ProviderHost) {}

  createSession(config: ProviderSessionConfig): ProviderExecutionSession {
    return new AgyExecutionSession(this.host, config);
  }
}
