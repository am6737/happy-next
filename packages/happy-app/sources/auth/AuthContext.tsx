import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { Platform } from 'react-native';
import { reloadAppAsync } from 'expo';
import { TokenStorage, AuthCredentials } from '@/auth/tokenStorage';
import { resumePushTokenRegistration, syncCreate } from '@/sync/sync';
import { clearPersistence } from '@/sync/persistence';
import { messageRepository } from '@/sync/messagesStore/messageRepository';
import { trackLogout } from '@/track';
import { measureLogoutStage } from './logoutTiming';
import { preparePushTokensForLogout } from './pushTokenLogoutFlow';
import { clearGithubSession } from '@/sync/github/client';

interface AuthContextType {
    isAuthenticated: boolean;
    credentials: AuthCredentials | null;
    login: (token: string, secret: string) => Promise<void>;
    logout: (afterPushCleanup?: () => void | Promise<void>) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children, initialCredentials }: { children: ReactNode; initialCredentials: AuthCredentials | null }) {
    const [isAuthenticated, setIsAuthenticated] = useState(!!initialCredentials);
    const [credentials, setCredentials] = useState<AuthCredentials | null>(initialCredentials);

    // Update global auth state when local state changes
    useEffect(() => {
        setCurrentAuth(credentials ? { isAuthenticated, credentials, login, logout } : null);
    }, [isAuthenticated, credentials]);

    const login = async (token: string, secret: string) => {
        const newCredentials: AuthCredentials = { token, secret };
        const success = await TokenStorage.setCredentials(newCredentials);
        if (success) {
            clearGithubSession();
            await syncCreate(newCredentials);
            setCredentials(newCredentials);
            setIsAuthenticated(true);
        } else {
            throw new Error('Failed to save credentials');
        }
    };

    const logout = async (afterPushCleanup?: () => void | Promise<void>) => {
        trackLogout();
        if (credentials) {
            await measureLogoutStage('push-cleanup', () => preparePushTokensForLogout(credentials));
            try {
                await measureLogoutStage('after-push-cleanup', async () => { await afterPushCleanup?.(); });
            } catch (error) {
                resumePushTokenRegistration();
                throw error;
            }
        } else {
            await measureLogoutStage('after-push-cleanup', async () => { await afterPushCleanup?.(); });
        }
        setCredentials(null);
        setIsAuthenticated(false);
        clearGithubSession();
        await measureLogoutStage('clear-persistence', async () => { clearPersistence(); });
        await measureLogoutStage('clear-messages', () => messageRepository.clearAll()).catch(() => {});
        await measureLogoutStage('remove-credentials', () => TokenStorage.removeCredentials());

        // Reload the entire JS bundle to reset all in-memory state (singletons, Zustand, socket, etc.)
        if (Platform.OS === 'web') {
            window.location.href = '/';
        } else {
            await measureLogoutStage('reload-app', () => reloadAppAsync('Logout'));
        }
    };

    return (
        <AuthContext.Provider
            value={{
                isAuthenticated,
                credentials,
                login,
                logout,
            }}
        >
            {children}
        </AuthContext.Provider>
    );
}

export function useAuth() {
    const context = useContext(AuthContext);
    if (context === undefined) {
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return context;
}

// Helper to get current auth state for non-React contexts
let currentAuthState: AuthContextType | null = null;

export function setCurrentAuth(auth: AuthContextType | null) {
    currentAuthState = auth;
}

export function getCurrentAuth(): AuthContextType | null {
    return currentAuthState;
}
