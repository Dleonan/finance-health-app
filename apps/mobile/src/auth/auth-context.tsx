import * as LocalAuthentication from 'expo-local-authentication';
import type { ReactNode } from 'react';
import { AppState } from 'react-native';
import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { getStoredRefreshToken, login, logout, refreshSession, register } from '../api/auth';

type AuthContextValue = {
  ready: boolean;
  authenticated: boolean;
  locked: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, displayName?: string) => Promise<void>;
  signOut: () => Promise<void>;
  unlock: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [locked, setLocked] = useState(false);
  const authenticatedRef = useRef(false);
  const lockedRef = useRef(false);

  useEffect(() => {
    authenticatedRef.current = authenticated;
    lockedRef.current = locked;
  }, [authenticated, locked]);

  useEffect(() => {
    void bootstrap();
  }, []);

  useEffect(() => {
    let previousState = AppState.currentState;
    const subscription = AppState.addEventListener('change', (nextState) => {
      const wasActive = previousState === 'active';
      const wasBackgrounded = previousState === 'inactive' || previousState === 'background';
      previousState = nextState;

      if (wasActive && (nextState === 'inactive' || nextState === 'background')) {
        void (async () => {
          if (authenticatedRef.current && (await biometricAvailable())) setLocked(true);
        })();
      } else if (
        wasBackgrounded &&
        nextState === 'active' &&
        authenticatedRef.current &&
        lockedRef.current
      ) {
        void unlock();
      }
    });
    return () => subscription.remove();
  }, []);

  async function bootstrap() {
    try {
      const token = await getStoredRefreshToken();
      if (!token) return;
      if (!(await authenticateBiometric())) {
        setLocked(true);
        return;
      }
      setAuthenticated(Boolean(await refreshSession()));
    } catch {
      setAuthenticated(false);
    } finally {
      setReady(true);
    }
  }

  async function unlock() {
    if (!(await authenticateBiometric())) return;
    setLocked(false);
    setAuthenticated(Boolean(await refreshSession()));
  }

  async function biometricAvailable() {
    try {
      return (
        (await LocalAuthentication.hasHardwareAsync()) &&
        (await LocalAuthentication.isEnrolledAsync())
      );
    } catch {
      return false;
    }
  }

  async function authenticateBiometric() {
    if (!(await biometricAvailable())) return true;
    try {
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Desbloquear Finance Health',
      });
      return result.success;
    } catch {
      return false;
    }
  }

  const value = useMemo(
    () => ({
      ready,
      authenticated,
      locked,
      signIn: async (email: string, password: string) => {
        await login(email, password);
        setAuthenticated(true);
      },
      signUp: async (email: string, password: string, displayName?: string) => {
        await register(email, password, displayName);
        setAuthenticated(true);
      },
      signOut: async () => {
        try {
          await logout();
        } finally {
          setAuthenticated(false);
          setLocked(false);
        }
      },
      unlock,
    }),
    [ready, authenticated, locked],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
}
