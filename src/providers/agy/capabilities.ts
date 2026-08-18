import type { ProviderCapabilities } from '../../core/providers/types';

/**
 * Print mode drives one process per turn with no interactive channel, so
 * rewind, fork, steering and provider commands have nothing to bind to.
 * History is Claudian's own: agy keeps its transcript in a private database
 * this provider does not read.
 *
 * Reasoning effort is part of the model id in agy's catalog
 * (`gemini-3.1-pro-high` vs `-low`), so there is no separate effort control.
 */
export const AGY_PROVIDER_CAPABILITIES: Readonly<ProviderCapabilities> = Object.freeze({
  providerId: 'agy',
  reasoningControl: 'none',
  supportsFork: false,
  supportsImageAttachments: false,
  supportsInstructionMode: true,
  supportsNativeHistory: false,
  supportsPlanMode: true,
  supportsProviderCommands: false,
  supportsRewind: false,
  supportsTurnSteer: false,
});
