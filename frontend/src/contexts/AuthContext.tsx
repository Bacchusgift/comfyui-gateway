import { createContext, useContext, useState, useEffect, ReactNode } from "react";

interface AuthContextType {
  token: string | null;
  username: string | null;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
  isAuthenticated: boolean;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem("auth_token"));
  const [username, setUsername] = useState<string | null>(() => localStorage.getItem("auth_username"));

  useEffect(() => {
    if (token) {
      localStorage.setItem("auth_token", token);
    } else {
      localStorage.removeItem("auth_token");
    }
  }, [token]);

  useEffect(() => {
    if (username) {
      localStorage.setItem("auth_username", username);
    } else {
      localStorage.removeItem("auth_username");
    }
  }, [username]);

  const login = async (usernameInput: string, password: string) => {
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: usernameInput, password }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: "登录失败" }));
      throw new Error(error.detail || "登录失败");
    }

    const data = await response.json();
    setToken(data.token);
    setUsername(data.username);
  };

  const logout = () => {
    setToken(null);
    setUsername(null);
    localStorage.removeItem("auth_token");
    localStorage.removeItem("auth_username");
  };

  return (
    <AuthContext.Provider value={{ token, username, login, logout, isAuthenticated: !!token }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
