/**
 * dsh-cubox — browser half. Registers the Cubox settings panel into the
 * web settings page (settings.section entry). The panel configures the
 * API-extension link, sync interval, and drives manual syncs. Failure
 * policy: registration problems are logged, never thrown — the web shell
 * fails the whole boot when a plugin apply throws, and an external plugin
 * must not take the GUI down.
 */
// Type-only: pulls the settings-surface SlotMap merge (the 'settings.section'
// entry) and the client runtime Context merge.
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { CuboxSettingsPanel } from './CuboxSettingsPanel.tsx'

/** Required services. */
export const inject = ['slots']

/**
 * Register the Cubox settings page.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  try {
    ctx.slots.inject('settings.section', () => ctx.slots.register({
      name: 'settings.section',
      id: 'cubox',
      order: 315,
      label: () => 'Cubox',
    }, CuboxSettingsPanel))
  } catch (error) {
    console.warn('[dsh-cubox] settings panel registration failed:', error)
  }
}
