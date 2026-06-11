import { createContext, useContext, ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Navigate, useLocation } from "react-router-dom";
import { authApi, CurrentUser } from "../api/client";

type AuthState = {
  user: CurrentUser | null;
  isLoading: boolean;
  refresh: () => void;
};

const AuthContext = createContext<AuthState>({
  user: null,
  isLoading: true,
  refresh: () => {},
});

export function useAuth() {
  return useContext(AuthContext);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["auth", "me"],
    queryFn: authApi.me,
    retry: false,
    staleTime: 5 * 60_000,
  });

  return (
    <AuthContext.Provider
      value={{
        user: data ?? null,
        isLoading,
        refresh: () => qc.invalidateQueries({ queryKey: ["auth", "me"] }),
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

function FullPageLoading() {
  return (
    <div className="min-h-screen flex items-center justify-center text-ink-500 text-sm">
      加载中…
    </div>
  );
}

export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, isLoading } = useAuth();
  const location = useLocation();
  if (isLoading) return <FullPageLoading />;
  if (!user) {
    const next = location.pathname + location.search;
    return <Navigate to={`/login?next=${encodeURIComponent(next)}`} replace />;
  }
  return <>{children}</>;
}

export function RequireAdmin({ children }: { children: ReactNode }) {
  const { user, isLoading } = useAuth();
  if (isLoading) return <FullPageLoading />;
  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== "admin") return <Navigate to="/" replace />;
  return <>{children}</>;
}
