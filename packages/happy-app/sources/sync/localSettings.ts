import * as z from 'zod';

//
// Schema
//

export const LocalSettingsSchema = z.object({
    // Developer settings (device-specific)
    debugMode: z.boolean().describe('Enable debug logging'),
    devModeEnabled: z.boolean().describe('Enable developer menu in settings'),
    commandPaletteEnabled: z.boolean().describe('Enable CMD+K command palette (web only)'),
    themePreference: z.enum(['light', 'dark', 'adaptive']).describe('Theme preference: light, dark, or adaptive (follows system)'),
    hideNotificationsWhenActive: z.boolean().describe('Hide all notifications while the app is active'),
    hideSessionNotificationsWhenActive: z.boolean().describe('Hide notifications for the currently open session while the app is active'),
    // CLI version acknowledgments - keyed by machineId
    acknowledgedCliVersions: z.record(z.string(), z.string()).describe('Acknowledged CLI versions per machine'),
    // Session list UI state (device-specific)
    sessionListSelectedTab: z.string().nullable().describe('Persisted selected tab in the session list ("all" / "shared" / "sharedByMe" / a machineId)'),
    machineNameCache: z.record(z.string(), z.string()).describe('Cached machineId -> display name, so machine tabs keep their names before machines sync on restart'),
    webSidebarWidth: z.number().finite().nullable().describe('Persisted web sidebar width in pixels'),
});

//
// NOTE: Local settings are device-specific and should NOT be synced.
// These are preferences that make sense to be different on each device.
//

const LocalSettingsSchemaPartial = LocalSettingsSchema.passthrough().partial();

export type LocalSettings = z.infer<typeof LocalSettingsSchema>;

//
// Defaults
//

export const localSettingsDefaults: LocalSettings = {
    debugMode: false,
    devModeEnabled: false,
    commandPaletteEnabled: false,
    themePreference: 'adaptive',
    hideNotificationsWhenActive: false,
    hideSessionNotificationsWhenActive: false,
    acknowledgedCliVersions: {},
    sessionListSelectedTab: null,
    machineNameCache: {},
    webSidebarWidth: null,
};
Object.freeze(localSettingsDefaults);

//
// Parsing
//

export function localSettingsParse(settings: unknown): LocalSettings {
    const parsed = LocalSettingsSchemaPartial.safeParse(settings);
    if (!parsed.success) {
        return { ...localSettingsDefaults };
    }
    return { ...localSettingsDefaults, ...parsed.data };
}

//
// Applying changes
//

export function applyLocalSettings(settings: LocalSettings, delta: Partial<LocalSettings>): LocalSettings {
    return { ...localSettingsDefaults, ...settings, ...delta };
}
