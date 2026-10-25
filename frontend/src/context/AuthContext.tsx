import React, { createContext, useContext, useEffect, useState } from 'react';
import { getCurrentUser, signOut, fetchAuthSession } from 'aws-amplify/auth';
import { ROLES, type Role } from '@app/shared';

interface AuthUser {
  sub: string;
  email: string;
  role: Role;
  emailVerified: boolean;
  isFederated: boolean;
}

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  const loadUser = async () => {
    try {
      const current = await getCurrentUser();
      const session = await fetchAuthSession({ forceRefresh: false });
      const payload = session.tokens?.idToken?.payload ?? {};
      const role = (payload['custom:role'] as Role) ?? ROLES.USER;
      // Prefer the email claim from the ID token: it is present for BOTH native
      // (email/password) and federated (Google) sign-ins. signInDetails.loginId
      // is only populated on native SRP sign-in, so for a Google login it is
      // empty — using it alone left "Email" blank after SSO.
      const email =
        (payload['email'] as string | undefined) ?? current.signInDetails?.loginId ?? '';
      // A federated (Google/SSO) sign-in carries an `identities` claim in the
      // ID token. Native email/password users do not. We use it to hide the
      // "change password" option (federated accounts have no app password).
      const identities = payload['identities'];
      const isFederated = Array.isArray(identities) && identities.length > 0;
      setUser({
        sub: current.userId,
        email,
        role,
        emailVerified: payload['email_verified'] === true,
        isFederated,
      });
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadUser();
  }, []);

  const logout = async () => {
    await signOut();
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, logout, refresh: loadUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
