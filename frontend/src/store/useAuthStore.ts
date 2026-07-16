import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { useSelectionStore } from "@/store/useSelectionStore";

export type AuthUser = {
  id: string;
  email: string;
  name: string;
  role: string;
  initials: string;
};

type AuthStore = {
  user: AuthUser | null;
  token: string | null;
  isAuthenticated: boolean;
  signIn: (user: AuthUser, token: string) => void;
  signOut: () => void;
};

export const useAuthStore = create<AuthStore>()(
  persist(
    (set) => ({
      user: null,
      token: null,
      isAuthenticated: false,
      signIn: (user, token) => set({ user, token, isAuthenticated: true }),
      signOut: () => {
        set({ user: null, token: null, isAuthenticated: false });
        // Otherwise a different user signing in on the same browser session
        // inherits the previous user's selected run/system, and their read
        // notifications keep showing as read for whoever signs in next.
        useSelectionStore.getState().reset();
        try {
          localStorage.removeItem("governai-read-notifications");
        } catch {
          // storage unavailable (e.g. private mode) — nothing to clear
        }
      },
    }),
    {
      name: "governai-auth",
      storage: createJSONStorage(() => sessionStorage), // session-scoped; cleared on tab close
      partialize: (state) => ({ user: state.user, token: state.token, isAuthenticated: state.isAuthenticated }),
    }
  )
);
