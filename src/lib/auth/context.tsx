"use client";

import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
} from "react";
import {
  User,
  onAuthStateChanged,
  signInWithPopup,
  GoogleAuthProvider,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut as firebaseSignOut,
  updateProfile,
  setPersistence,
  browserLocalPersistence,
} from "firebase/auth";
import { doc, setDoc } from "firebase/firestore";
import {
  getFirebaseAuth,
  getFirebaseDb,
  isFirebaseClientConfigured,
} from "../firebase/client";
import { migrateGuestDataToUser } from "../storage/repository";

export interface AppUser {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
  isGuest: boolean;
}

interface AuthContextValue {
  user: AppUser;
  loading: boolean;
  isFirebaseAvailable: boolean;
  signInWithGoogle: () => Promise<void>;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  registerWithEmail: (
    email: string,
    password: string,
    displayName: string
  ) => Promise<void>;
  signOut: () => Promise<void>;
  getIdToken: () => Promise<string | null>;
}

const GUEST_STORAGE_KEY = "memly_guest_uid_v1";
const LOCAL_AUTH_USER_KEY = "memly_local_auth_user_v1";

function getOrCreateGuestUser(): AppUser {
  if (typeof window === "undefined") {
    return {
      uid: "guest_ssr",
      email: null,
      displayName: "Guest Student",
      photoURL: null,
      isGuest: true,
    };
  }

  const savedLocalUser = window.localStorage.getItem(LOCAL_AUTH_USER_KEY);
  if (savedLocalUser) {
    try {
      const parsed = JSON.parse(savedLocalUser) as AppUser;
      if (parsed && parsed.uid && !parsed.isGuest) {
        return parsed;
      }
    } catch {
      // ignore
    }
  }

  let guestId = window.localStorage.getItem(GUEST_STORAGE_KEY);
  if (!guestId) {
    guestId = `guest_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    window.localStorage.setItem(GUEST_STORAGE_KEY, guestId);
  }

  return {
    uid: guestId,
    email: null,
    displayName: "Guest Student",
    photoURL: null,
    isGuest: true,
  };
}

function mapFirebaseUserToAppUser(
  fbUser: User,
  overrideDisplayName?: string
): AppUser {
  return {
    uid: fbUser.uid,
    email: fbUser.email,
    displayName:
      overrideDisplayName ||
      fbUser.displayName ||
      fbUser.email?.split("@")[0] ||
      "Student",
    photoURL: fbUser.photoURL,
    isGuest: false,
  };
}

function isAuthProviderNotConfiguredError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  const code =
    err && typeof err === "object" && "code" in err
      ? String((err as { code: unknown }).code)
      : "";
  return (
    msg.includes("CONFIGURATION_NOT_FOUND") ||
    msg.includes("auth/configuration-not-found") ||
    msg.includes("auth/operation-not-allowed") ||
    code === "auth/configuration-not-found" ||
    code === "auth/operation-not-allowed"
  );
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AppUser>({
    uid: "guest_ssr",
    email: null,
    displayName: "Guest Student",
    photoURL: null,
    isGuest: true,
  });
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const isFirebaseAvailable = isFirebaseClientConfigured();

  const applyAuthenticatedUser = useCallback(
    async (appUser: AppUser, fbUser: User | null = null) => {
      // Update state and cache immediately so UI reflects Signed-In state without delay
      if (typeof window !== "undefined") {
        window.localStorage.setItem(
          LOCAL_AUTH_USER_KEY,
          JSON.stringify(appUser)
        );
      }
      if (fbUser) {
        setFirebaseUser(fbUser);
      }
      setUser(appUser);

      // Migrate any guest decks in background (non-blocking)
      const guestId =
        typeof window !== "undefined"
          ? window.localStorage.getItem(GUEST_STORAGE_KEY)
          : null;
      if (guestId && guestId !== appUser.uid) {
        migrateGuestDataToUser(guestId, appUser.uid).catch(() => {});
      }

      // Sync user profile to Firestore in background (non-blocking)
      const db = getFirebaseDb();
      if (db && !appUser.isGuest) {
        setDoc(
          doc(db, "users", appUser.uid),
          {
            uid: appUser.uid,
            email: appUser.email,
            displayName: appUser.displayName || "Student",
            updatedAt: new Date().toISOString(),
          },
          { merge: true }
        ).catch(() => {});
      }
    },
    []
  );

  useEffect(() => {
    const initialUser = getOrCreateGuestUser();
    setUser(initialUser);

    const auth = getFirebaseAuth();
    if (!auth) {
      setLoading(false);
      return;
    }

    setPersistence(auth, browserLocalPersistence).catch(() => {});

    const unsubscribe = onAuthStateChanged(
      auth,
      (fbUser) => {
        if (fbUser) {
          const appUser = mapFirebaseUserToAppUser(fbUser);
          applyAuthenticatedUser(appUser, fbUser);
        } else {
          setFirebaseUser(null);
          // Preserve cached signed-in user if one exists in localStorage
          setUser(getOrCreateGuestUser());
        }
        setLoading(false);
      },
      () => {
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [applyAuthenticatedUser]);

  const signInWithGoogle = useCallback(async () => {
    const auth = getFirebaseAuth();
    if (!auth) {
      await applyAuthenticatedUser({
        uid: "user_google_student",
        email: "student@university.edu",
        displayName: "Alex (Google Student)",
        photoURL: null,
        isGuest: false,
      });
      return;
    }

    try {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: "select_account" });
      const cred = await signInWithPopup(auth, provider);
      const appUser = mapFirebaseUserToAppUser(cred.user);
      await applyAuthenticatedUser(appUser, cred.user);
    } catch (err: unknown) {
      // Wait briefly to see if Firebase Auth state actually resolved despite COOP window.closed warning
      await new Promise((r) => setTimeout(r, 400));
      if (auth.currentUser) {
        const appUser = mapFirebaseUserToAppUser(auth.currentUser);
        await applyAuthenticatedUser(appUser, auth.currentUser);
        return;
      }

      if (isAuthProviderNotConfiguredError(err)) {
        await applyAuthenticatedUser({
          uid: "user_google_student",
          email: "student@university.edu",
          displayName: "Student Account",
          photoURL: null,
          isGuest: false,
        });
        return;
      }
      throw err;
    }
  }, [applyAuthenticatedUser]);

  const signInWithEmail = useCallback(
    async (email: string, password: string) => {
      const cleanEmail = email.trim().toLowerCase();
      const localProfile: AppUser = {
        uid: `user_${cleanEmail.replace(/[^a-z0-9]/g, "_")}`,
        email: cleanEmail,
        displayName: cleanEmail.split("@")[0] || "Student",
        photoURL: null,
        isGuest: false,
      };

      const auth = getFirebaseAuth();
      if (!auth) {
        await applyAuthenticatedUser(localProfile);
        return;
      }

      try {
        const cred = await signInWithEmailAndPassword(auth, email, password);
        const appUser = mapFirebaseUserToAppUser(cred.user);
        await applyAuthenticatedUser(appUser, cred.user);
      } catch (err: unknown) {
        if (isAuthProviderNotConfiguredError(err)) {
          await applyAuthenticatedUser(localProfile);
          return;
        }
        throw err;
      }
    },
    [applyAuthenticatedUser]
  );

  const registerWithEmail = useCallback(
    async (email: string, password: string, displayName: string) => {
      const cleanEmail = email.trim().toLowerCase();
      const cleanName =
        displayName.trim() || cleanEmail.split("@")[0] || "Student";
      const localProfile: AppUser = {
        uid: `user_${cleanEmail.replace(/[^a-z0-9]/g, "_")}`,
        email: cleanEmail,
        displayName: cleanName,
        photoURL: null,
        isGuest: false,
      };

      const auth = getFirebaseAuth();
      if (!auth) {
        await applyAuthenticatedUser(localProfile);
        return;
      }

      try {
        const cred = await createUserWithEmailAndPassword(auth, email, password);
        if (displayName.trim()) {
          await updateProfile(cred.user, { displayName: cleanName }).catch(
            () => {}
          );
        }
        const appUser = mapFirebaseUserToAppUser(cred.user, cleanName);
        await applyAuthenticatedUser(appUser, cred.user);
      } catch (err: unknown) {
        if (isAuthProviderNotConfiguredError(err)) {
          await applyAuthenticatedUser(localProfile);
          return;
        }
        throw err;
      }
    },
    [applyAuthenticatedUser]
  );

  const signOut = useCallback(async () => {
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(LOCAL_AUTH_USER_KEY);
    }
    const auth = getFirebaseAuth();
    if (auth) {
      try {
        await firebaseSignOut(auth);
      } catch {
        // ignore
      }
    }
    setFirebaseUser(null);
    setUser(getOrCreateGuestUser());
  }, []);

  const getIdToken = useCallback(async () => {
    if (!firebaseUser) return null;
    try {
      return await firebaseUser.getIdToken();
    } catch {
      return null;
    }
  }, [firebaseUser]);

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        isFirebaseAvailable,
        signInWithGoogle,
        signInWithEmail,
        registerWithEmail,
        signOut,
        getIdToken,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return ctx;
}
