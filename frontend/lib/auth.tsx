"use client";

import router from "next/router";
import React, { createContext, useContext, useEffect, useState } from "react";
import type { SessionCreate } from "../../backend/actions/session";
import type {
  UserCreate,
  UserEdit,
  UserView,
} from "../../backend/actions/user";
import type { ActionResponse } from "../../backend/classes/Action";
import { APIWrapper } from "./api";

type User = ActionResponse<UserView>["user"];

interface AuthContextType {
  user: User | null;
  loading: boolean;
  signup: (data: UserCreate["inputs"]["_type"]) => Promise<void>;
  signin: (data: SessionCreate["inputs"]["_type"]) => Promise<void>;
  signout: () => Promise<void>;
  checkAuth: () => Promise<void>;
  updateUser: (data: {
    name?: string;
    email?: string;
    password?: string;
    metadata?: string;
  }) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const checkAuth = async () => {
    try {
      const data = await APIWrapper.get<UserView>("/user");
      setUser(data.user);
    } catch (error) {
      console.log("Auth check failed:", error);
      setUser(null);
    } finally {
      setLoading(false);
    }
  };

  const signup = async (data: UserCreate["inputs"]["_type"]) => {
    const responseData = await APIWrapper.put<UserCreate>("/user", data);
    setUser(responseData.user);
  };

  const signin = async (data: SessionCreate["inputs"]["_type"]) => {
    const responseData = await APIWrapper.put<SessionCreate>("/session", data);
    setUser(responseData.user);
  };

  const signout = async () => {
    try {
      await APIWrapper.delete("/session");
    } catch (error) {
      console.error("Signout error:", error);
    } finally {
      setUser(null);
      router.push("/");
    }
  };

  const updateUser = async (data: {
    name?: string;
    email?: string;
    password?: string;
    metadata?: string;
  }) => {
    const responseData = await APIWrapper.post<UserEdit>("/user", data);
    setUser(responseData.user);
  };

  useEffect(() => {
    checkAuth();
  }, []);

  return (
    <AuthContext.Provider
      value={{ user, loading, signup, signin, signout, checkAuth, updateUser }}
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
