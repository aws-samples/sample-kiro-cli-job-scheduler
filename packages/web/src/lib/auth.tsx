"use client";

import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { Amplify } from "aws-amplify";
import { signIn, signUp, signOut, getCurrentUser, fetchAuthSession, confirmSignUp } from "aws-amplify/auth";

let configured = false;
function ensureConfigured() {
  if (configured) return;
  Amplify.configure({
    Auth: {
      Cognito: {
        userPoolId: process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID!,
        userPoolClientId: process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID!,
      },
    },
  });
  configured = true;
}

interface AuthUser {
  userId: string;
  email: string;
}

interface AuthContextType {
  user: AuthUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string) => Promise<{ needsConfirmation: boolean }>;
  confirmRegistration: (email: string, code: string) => Promise<void>;
  logout: () => Promise<void>;
  getToken: () => Promise<string | null>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  isAuthenticated: false,
  isLoading: true,
  login: async () => {},
  register: async () => ({ needsConfirmation: false }),
  confirmRegistration: async () => {},
  logout: async () => {},
  getToken: async () => null,
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    checkUser();
  }, []);

  const checkUser = async () => {
    // Quick check: if no Amplify keys in localStorage, user is definitely not logged in
    const hasLocalSession = typeof window !== "undefined" && 
      Object.keys(localStorage).some((k) => k.startsWith("CognitoIdentityServiceProvider"));
    
    if (!hasLocalSession) {
      setUser(null);
      setIsLoading(false);
      return;
    }

    // Has local tokens — try to verify with Cognito (with timeout)
    let resolved = false;
    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        // Assume logged in based on local tokens, will fail on API calls if expired
        const keys = Object.keys(localStorage);
        const emailKey = keys.find((k) => k.includes(".email"));
        const email = emailKey ? localStorage.getItem(emailKey) || "" : "";
        setUser({ userId: "cached", email });
        setIsLoading(false);
      }
    }, 1500);

    try {
      ensureConfigured();
      const cognitoUser = await getCurrentUser();
      const session = await fetchAuthSession();
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        const email = session.tokens?.idToken?.payload?.email as string || cognitoUser.signInDetails?.loginId || "";
        setUser({ userId: cognitoUser.userId, email });
        setIsLoading(false);
      }
    } catch {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        setUser(null);
        setIsLoading(false);
      }
    }
  };

  const login = async (email: string, password: string) => {
    ensureConfigured();
    const result = await signIn({ username: email, password });
    if (result.isSignedIn) {
      await checkUser();
    } else {
      throw new Error("Sign in incomplete: " + result.nextStep?.signInStep);
    }
  };

  const register = async (email: string, password: string) => {
    ensureConfigured();
    const result = await signUp({ username: email, password, options: { userAttributes: { email } } });
    if (result.isSignUpComplete) {
      return { needsConfirmation: false };
    }
    return { needsConfirmation: true };
  };

  const confirmRegistration = async (email: string, code: string) => {
    await confirmSignUp({ username: email, confirmationCode: code });
  };

  const logout = async () => {
    await signOut();
    setUser(null);
  };

  const getToken = async (): Promise<string | null> => {
    try {
      const session = await fetchAuthSession();
      return session.tokens?.idToken?.toString() || null;
    } catch {
      return null;
    }
  };

  return (
    <AuthContext.Provider value={{ user, isAuthenticated: !!user, isLoading, login, register, confirmRegistration, logout, getToken }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
