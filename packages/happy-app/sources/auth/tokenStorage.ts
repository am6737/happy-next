import * as SecureStore from 'expo-secure-store';
import { invoke } from '@tauri-apps/api/core';
import { Platform } from 'react-native';

import { isTauriDesktop } from '@/utils/tauri';

const AUTH_KEY = 'auth_credentials';

// Cache for synchronous access
let credentialsCache: string | null = null;

export interface AuthCredentials {
    token: string;
    secret: string;
}

function clearLegacyDesktopCredentials(): void {
    localStorage.removeItem(AUTH_KEY);
}

export const TokenStorage = {
    async getCredentials(): Promise<AuthCredentials | null> {
        if (isTauriDesktop()) {
            try {
                clearLegacyDesktopCredentials();
                return await invoke<AuthCredentials | null>('desktop_get_credentials');
            } catch (error) {
                console.error('Error getting desktop credentials:', error);
                return null;
            }
        }
        if (Platform.OS === 'web') {
            return localStorage.getItem(AUTH_KEY) ? JSON.parse(localStorage.getItem(AUTH_KEY)!) as AuthCredentials : null;
        }
        try {
            const stored = await SecureStore.getItemAsync(AUTH_KEY);
            if (!stored) return null;
            credentialsCache = stored; // Update cache
            return JSON.parse(stored) as AuthCredentials;
        } catch (error) {
            console.error('Error getting credentials:', error);
            return null;
        }
    },

    async setCredentials(credentials: AuthCredentials): Promise<boolean> {
        if (isTauriDesktop()) {
            try {
                clearLegacyDesktopCredentials();
                await invoke('desktop_set_credentials', { credentials });
                return true;
            } catch (error) {
                console.error('Error setting desktop credentials:', error);
                return false;
            }
        }
        if (Platform.OS === 'web') {
            localStorage.setItem(AUTH_KEY, JSON.stringify(credentials));
            return true;
        }
        try {
            const json = JSON.stringify(credentials);
            await SecureStore.setItemAsync(AUTH_KEY, json);
            credentialsCache = json; // Update cache
            return true;
        } catch (error) {
            console.error('Error setting credentials:', error);
            return false;
        }
    },

    async removeCredentials(): Promise<boolean> {
        if (isTauriDesktop()) {
            try {
                clearLegacyDesktopCredentials();
                await invoke('desktop_remove_credentials');
                return true;
            } catch (error) {
                console.error('Error removing desktop credentials:', error);
                return false;
            }
        }
        if (Platform.OS === 'web') {    
            localStorage.removeItem(AUTH_KEY);
            return true;
        }
        try {
            await SecureStore.deleteItemAsync(AUTH_KEY);
            credentialsCache = null; // Clear cache
            return true;
        } catch (error) {
            console.error('Error removing credentials:', error);
            return false;
        }
    },
};
