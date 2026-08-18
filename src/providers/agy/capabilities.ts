import type { ProviderCapabilities } from '../../core/providers/types';

/**
 * Print mode drives one process per turn with no interactive channel, so
 * rewind, fork, steering and provider commands have nothing to bind to.
 * History is Claudian's own: agy keeps its transcript in a private database
 * this provider does not read.
 *
 * agy publishes one catalog entry per effort level rather than an effort
 * control, so the variants are split apart and offered as reasoning effort;
 * a model agy offers at a single effort shows no effort control at all.
 *
 * Images are supported indirectly: print mode has no image input, but agy's
 * file viewer returns image content to the model, so attachments are written
 * into the vault and referenced by path.
 */
export const AGY_PROVIDER_CAPABILITIES: Readonly<ProviderCapabilities> = Object.freeze({
  providerId: 'agy',
  reasoningControl: 'effort',
  supportsFork: false,
  supportsImageAttachments: true,
  supportsInstructionMode: true,
  supportsNativeHistory: false,
  supportsPlanMode: true,
  supportsProviderCommands: false,
  supportsRewind: false,
  supportsTurnSteer: false,
});
