import type { ProviderCapabilities } from '../../core/providers/types';

/**
 * Print mode drives one process per turn with no interactive channel, so
 * rewind, fork, steering and provider commands have nothing to bind to.
 * History is Claudian's own: agy keeps its transcript in a private database
 * this provider does not read.
 *
 * Reasoning effort is part of the model id in agy's catalog
 * (`gemini-3.1-pro-high` vs `-low`), so there is no separate effort control.
 *
 * Images are supported indirectly: print mode has no image input, but agy's
 * file viewer returns image content to the model, so attachments are written
 * into the vault and referenced by path.
 */
export const AGY_PROVIDER_CAPABILITIES: Readonly<ProviderCapabilities> = Object.freeze({
  providerId: 'agy',
  reasoningControl: 'none',
  supportsFork: false,
  supportsImageAttachments: true,
  supportsInstructionMode: true,
  supportsNativeHistory: false,
  supportsPlanMode: true,
  supportsProviderCommands: false,
  supportsRewind: false,
  supportsTurnSteer: false,
});
