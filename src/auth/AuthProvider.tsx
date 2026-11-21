import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type { User } from "@supabase/supabase-js";
import { isSupabaseConfigured, supabase } from "../lib/supabase";

type AuthContextValue = {
  user: User | null;
  isConfigured: boolean;
  isLoading: boolean;
  initializationError: string | null;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (
    displayName: string,
    email: string,
    password: string,
  ) => Promise<{ needsEmailConfirmation: boolean }>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(isSupabaseConfigured);
  const [initializationError, setInitializationError] = useState<string | null>(
    null,
  );

  useEffect(() => {
    if (!supabase) {
      setIsLoading(false);
      return;
    }

    let active = true;
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) return;
      setUser(session?.user ?? null);
      setIsLoading(false);
      setInitializationError(null);
    });

    void supabase.auth
      .getSession()
      .then(({ data, error }) => {
        if (!active) return;
        if (error) {
          setInitializationError(error.message);
        } else {
          setUser(data.session?.user ?? null);
        }
        setIsLoading(false);
      })
      .catch((error: unknown) => {
        if (!active) return;
        setInitializationError(
          error instanceof Error
            ? error.message
            : "Impossible de vérifier la session Supabase.",
        );
        setIsLoading(false);
      });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  const signIn = async (email: string, password: string) => {
    if (!supabase) throw new Error("Supabase n’est pas configuré.");
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
  };

  const signUp = async (
    displayName: string,
    email: string,
    password: string,
  ) => {
    if (!supabase) throw new Error("Supabase n’est pas configuré.");
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { display_name: displayName } },
    });
    if (error) throw error;
    return { needsEmailConfirmation: data.session === null };
  };

  const signOut = async () => {
    if (!supabase) throw new Error("Supabase n’est pas configuré.");
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isConfigured: isSupabaseConfigured,
        isLoading,
        initializationError,
        signIn,
        signUp,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth doit être utilisé dans AuthProvider.");
  }
  return context;
}
