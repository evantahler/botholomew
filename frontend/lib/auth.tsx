"use client";

import React, { createContext, useContext, useEffect, useState } from "react";
import { getApiUrl } from "./config";
import type { UserCreate, UserView } from "../../backend/actions/user";
import type {
  SessionCreate,
  SessionDestroy,
} from "../../backend/actions/session";
import type {
  ActionResponse,
  ActionParams,
} from "../../backend/classes/Action";
import router from "next/router";

// Types derived from action responses and inputs
type User = ActionResponse<UserView>["user"];
type SigninInput = ActionParams<SessionCreate>;
type SignupInput = ActionParams<UserCreate>;
type SigninResponse = ActionResponse<SessionCreate>;
type SignupResponse = ActionResponse<UserCreate>;

interface AuthContextType {
  user: User | null;
  loading: boolean;
  signup: (data: SignupInput) => Promise<void>;
  signin: (data: SigninInput) => Promise<void>;
  signout: () => Promise<void>;
  checkAuth: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const checkAuth = async () => {
    try {
      const response = await fetch(getApiUrl("/user"), {
        method: "GET",
        credentials: "include",
      });

      if (response.ok) {
        const data = await response.json();
        setUser(data.user);
      } else {
        setUser(null);
      }
    } catch (error) {
      console.error("Auth check failed:", error);
      setUser(null);
    } finally {
      setLoading(false);
    }
  };

  const signup = async (data: SignupInput) => {
    const response = await fetch(getApiUrl("/user"), {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      credentials: "include",
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || "Signup failed");
    }

    const responseData: SignupResponse = await response.json();
    setUser(responseData.user);
  };

  const signin = async (data: SigninInput) => {
    const response = await fetch(getApiUrl("/session"), {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      credentials: "include",
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || "Signin failed");
    }

    const responseData: SigninResponse = await response.json();
    setUser(responseData.user);
  };

  const signout = async () => {
    try {
      await fetch(getApiUrl("/session"), {
        method: "DELETE",
        credentials: "include",
      });
    } catch (error) {
      console.error("Signout error:", error);
    } finally {
      setUser(null);
      router.push("/");
    }
  };

  useEffect(() => {
    checkAuth();
  }, []);

  return (
    <AuthContext.Provider
      value={{ user, loading, signup, signin, signout, checkAuth }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
