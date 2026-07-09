import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

/**
 * Client-side store for the auditor's personal collaboration surfaces:
 * assignments (a personal review worklist) and notes/queries (threaded review
 * notes + clarification queries to system owners).
 *
 * IMPORTANT — this is a FRONTEND-ONLY interactive layer. The backend has no
 * assignments table, no notes/queries entity, and no authenticated auditor
 * identity to attribute or route these to. Rather than fake read-only rows, we
 * let the auditor actually create/manage these locally so the workflow is
 * demonstrable end-to-end. Data persists in this browser (localStorage) only —
 * it is NOT shared across users and NOT stored on the server. The pages say so
 * plainly (see DemoDataBanner). The moment the backend grows these tables,
 * swap this store for the real API and the UIs stay the same.
 */

function uid(): string {
  // Browser runtime — crypto.randomUUID is available; guard for older engines.
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `id-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
}

function now(): string {
  return new Date().toISOString();
}

/* ─────────────────────────────────────────────────────── assignments ── */

export type AssignmentStatus = "todo" | "in_review" | "done";
export type Priority = "high" | "medium" | "low";

export const ASSIGNMENT_STATUSES: AssignmentStatus[] = ["todo", "in_review", "done"];

export type Assignment = {
  id: string;
  runId: string;
  systemId: string;
  systemName: string;
  priority: Priority;
  status: AssignmentStatus;
  /** ISO date (yyyy-mm-dd) or null when no due date set. */
  dueDate: string | null;
  note: string;
  createdAt: string;
  updatedAt: string;
};

/* ────────────────────────────────────────────────── notes & queries ── */

export type ThreadKind = "note" | "query";
export type ThreadStatus = "open" | "resolved";
export type ThreadScopeType = "system" | "run";

export type CollabMessage = {
  id: string;
  author: string;
  authorInitials: string;
  body: string;
  createdAt: string;
};

export type CollabThread = {
  id: string;
  kind: ThreadKind;
  scopeType: ThreadScopeType;
  scopeId: string;
  scopeLabel: string;
  subject: string;
  status: ThreadStatus;
  createdAt: string;
  updatedAt: string;
  messages: CollabMessage[];
};

/* ─────────────────────────────────────────────────────────── store ── */

type Author = { name: string; initials: string };

type AuditorCollabStore = {
  assignments: Assignment[];
  threads: CollabThread[];

  addAssignment: (input: {
    runId: string;
    systemId: string;
    systemName: string;
    priority: Priority;
    dueDate: string | null;
    note: string;
  }) => void;
  updateAssignment: (id: string, patch: Partial<Pick<Assignment, "status" | "priority" | "dueDate" | "note">>) => void;
  removeAssignment: (id: string) => void;

  addThread: (input: {
    kind: ThreadKind;
    scopeType: ThreadScopeType;
    scopeId: string;
    scopeLabel: string;
    subject: string;
    body: string;
    author: Author;
  }) => string;
  addMessage: (threadId: string, input: { body: string; author: Author }) => void;
  setThreadStatus: (threadId: string, status: ThreadStatus) => void;
  removeThread: (id: string) => void;

  reset: () => void;
};

export const useAuditorCollabStore = create<AuditorCollabStore>()(
  persist(
    (set) => ({
      assignments: [],
      threads: [],

      addAssignment: (input) =>
        set((s) => ({
          assignments: [
            {
              id: uid(),
              runId: input.runId,
              systemId: input.systemId,
              systemName: input.systemName,
              priority: input.priority,
              status: "todo",
              dueDate: input.dueDate,
              note: input.note,
              createdAt: now(),
              updatedAt: now(),
            },
            ...s.assignments,
          ],
        })),

      updateAssignment: (id, patch) =>
        set((s) => ({
          assignments: s.assignments.map((a) =>
            a.id === id ? { ...a, ...patch, updatedAt: now() } : a,
          ),
        })),

      removeAssignment: (id) =>
        set((s) => ({ assignments: s.assignments.filter((a) => a.id !== id) })),

      addThread: (input) => {
        const id = uid();
        const ts = now();
        set((s) => ({
          threads: [
            {
              id,
              kind: input.kind,
              scopeType: input.scopeType,
              scopeId: input.scopeId,
              scopeLabel: input.scopeLabel,
              subject: input.subject,
              status: "open",
              createdAt: ts,
              updatedAt: ts,
              messages: [
                {
                  id: uid(),
                  author: input.author.name,
                  authorInitials: input.author.initials,
                  body: input.body,
                  createdAt: ts,
                },
              ],
            },
            ...s.threads,
          ],
        }));
        return id;
      },

      addMessage: (threadId, input) =>
        set((s) => ({
          threads: s.threads.map((t) =>
            t.id === threadId
              ? {
                  ...t,
                  updatedAt: now(),
                  messages: [
                    ...t.messages,
                    {
                      id: uid(),
                      author: input.author.name,
                      authorInitials: input.author.initials,
                      body: input.body,
                      createdAt: now(),
                    },
                  ],
                }
              : t,
          ),
        })),

      setThreadStatus: (threadId, status) =>
        set((s) => ({
          threads: s.threads.map((t) =>
            t.id === threadId ? { ...t, status, updatedAt: now() } : t,
          ),
        })),

      removeThread: (id) =>
        set((s) => ({ threads: s.threads.filter((t) => t.id !== id) })),

      reset: () => set({ assignments: [], threads: [] }),
    }),
    {
      name: "governai-auditor-collab",
      storage: createJSONStorage(() => localStorage),
    },
  ),
);
