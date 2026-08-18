import type { ProviderHost } from '../../../core/providers/ProviderHost';
import { ProviderWorkspaceRegistry } from '../../../core/providers/ProviderWorkspaceRegistry';
import type {
  ProviderWorkspaceRegistration,
  ProviderWorkspaceServices,
} from '../../../core/providers/types';
import { AgyCliResolver } from '../runtime/AgyCliResolver';
import {
  type AgyModelDiscoveryResult,
  AgyModelDiscoveryService,
} from '../runtime/AgyModelDiscoveryService';
import { agySettingsTabRenderer } from '../ui/AgySettingsTab';

export interface AgyWorkspaceServices extends ProviderWorkspaceServices {
  cliResolver: AgyCliResolver;
  refreshModelCatalog(): Promise<AgyModelDiscoveryResult>;
  prepareSettings(): Promise<void>;
}

export function createAgyWorkspaceServices(plugin: ProviderHost): AgyWorkspaceServices {
  const cliResolver = new AgyCliResolver();
  const discoveryService = new AgyModelDiscoveryService(plugin, cliResolver);

  return {
    cliResolver,
    settingsTabRenderer: agySettingsTabRenderer,
    refreshModelCatalog: () => discoveryService.refresh(),
    async prepareSettings(): Promise<void> {
      // A stale catalog is better than a settings pane that waits on a
      // subprocess, so discovery failures stay silent here and surface on the
      // explicit refresh instead.
      await discoveryService.refresh();
    },
  };
}

export const agyWorkspaceRegistration: ProviderWorkspaceRegistration<AgyWorkspaceServices> = {
  initialize: async ({ plugin }) => createAgyWorkspaceServices(plugin),
};

export function getAgyWorkspaceServices(): AgyWorkspaceServices {
  return ProviderWorkspaceRegistry.requireServices('agy') as unknown as AgyWorkspaceServices;
}
