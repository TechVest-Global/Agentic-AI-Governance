import { useMemo, useState } from "react";
import {
  CheckCircle2,
  HelpCircle,
  MessagesSquare,
  Plus,
  RotateCcw,
  Send,
  StickyNote,
  Trash2,
} from "lucide-react";
import clsx from "clsx";
import { useAuthStore } from "@/store/useAuthStore";
import { useAuditorWorkspace } from "@/hooks/useAuditorWorkspace";
import {
  useAuditorCollabStore,
  type CollabThread,
  type ThreadKind,
  type ThreadScopeType,
  type ThreadStatus,
} from "@/store/useAuditorCollabStore";
import {
  AuditorModal,
  AuditorPageHeader,
  DemoDataBanner,
  shortId,
  timeAgo,
} from "./components";

/**
 * Notes & Queries — threaded review notes and clarification queries to system
 * owners, scoped per system or run. No backend notes/queries entity or auditor
 * identity exists yet, so this is a frontend-only interactive layer (see
 * useAuditorCollabStore): threads and replies persist in this browser only.
 */

type KindFilter = "all" | ThreadKind;
type StatusFilter = "all" | ThreadStatus;

const KIND_META: Record<ThreadKind, { label: string; icon: typeof StickyNote; tone: string }> = {
  note: { label: "Note", icon: StickyNote, tone: "text-slate-500" },
  query: { label: "Query", icon: HelpCircle, tone: "text-brand-600 dark:text-brand-400" },
};

export function NotesQueries() {
  const user = useAuthStore((s) => s.user);
  const workspace = useAuditorWorkspace();
  const threads = useAuditorCollabStore((s) => s.threads);
  const addThread = useAuditorCollabStore((s) => s.addThread);
  const addMessage = useAuditorCollabStore((s) => s.addMessage);
  const setThreadStatus = useAuditorCollabStore((s) => s.setThreadStatus);
  const removeThread = useAuditorCollabStore((s) => s.removeThread);

  const [kindFilter, setKindFilter] = useState<KindFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [composing, setComposing] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [reply, setReply] = useState("");

  const author = useMemo(
    () => ({ name: user?.name ?? "You", initials: user?.initials ?? "YOU" }),
    [user],
  );

  const filtered = useMemo(
    () =>
      threads.filter(
        (t) =>
          (kindFilter === "all" || t.kind === kindFilter) &&
          (statusFilter === "all" || t.status === statusFilter),
      ),
    [threads, kindFilter, statusFilter],
  );

  const selected =
    filtered.find((t) => t.id === selectedId) ?? filtered[0] ?? null;

  function submitReply() {
    if (!selected || !reply.trim()) return;
    addMessage(selected.id, { body: reply.trim(), author });
    setReply("");
  }

  const openCount = threads.filter((t) => t.status === "open").length;

  return (
    <div className="space-y-5">
      <AuditorPageHeader
        eyebrow="Collaboration"
        title="Notes & Queries"
        description="Keep threaded review notes and raise clarification queries to system owners — scoped per system or run, with status tracking."
        action={
          <button
            onClick={() => setComposing(true)}
            className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-3.5 py-2 text-[13px] font-semibold text-white hover:bg-brand-700"
          >
            <Plus className="h-4 w-4" />
            New thread
          </button>
        }
      />

      <DemoDataBanner>
        Local-only interactive preview. There's no backend notes/queries table or auditor identity yet, so
        threads are saved in <strong>this browser only</strong> — not on the server and not routed to system
        owners. The threading, replies, and resolve workflow are fully functional for demonstration.
      </DemoDataBanner>

      {threads.length === 0 ? (
        <EmptyThreads onNew={() => setComposing(true)} />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[340px_1fr]">
          {/* Thread list */}
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-1.5">
              <FilterChip label={`All (${threads.length})`} active={kindFilter === "all"} onClick={() => setKindFilter("all")} />
              <FilterChip label="Notes" active={kindFilter === "note"} onClick={() => setKindFilter("note")} />
              <FilterChip label="Queries" active={kindFilter === "query"} onClick={() => setKindFilter("query")} />
              <span className="mx-1 h-4 w-px bg-slate-200 dark:bg-slate-700" />
              <FilterChip label={`Open (${openCount})`} active={statusFilter === "open"} onClick={() => setStatusFilter(statusFilter === "open" ? "all" : "open")} />
              <FilterChip label="Resolved" active={statusFilter === "resolved"} onClick={() => setStatusFilter(statusFilter === "resolved" ? "all" : "resolved")} />
            </div>

            <div className="space-y-2">
              {filtered.length === 0 ? (
                <p className="rounded-lg border border-dashed border-slate-200 dark:border-slate-700 px-3 py-6 text-center text-[12px] text-slate-400">
                  No threads match this filter.
                </p>
              ) : (
                filtered.map((t) => (
                  <ThreadListItem
                    key={t.id}
                    thread={t}
                    active={selected?.id === t.id}
                    onClick={() => setSelectedId(t.id)}
                  />
                ))
              )}
            </div>
          </div>

          {/* Detail */}
          {selected ? (
            <ThreadDetail
              key={selected.id}
              thread={selected}
              reply={reply}
              onReply={setReply}
              onSubmit={submitReply}
              onToggleStatus={() =>
                setThreadStatus(selected.id, selected.status === "open" ? "resolved" : "open")
              }
              onRemove={() => {
                removeThread(selected.id);
                setSelectedId(null);
              }}
            />
          ) : (
            <div className="flex items-center justify-center rounded-xl border border-dashed border-slate-200 dark:border-slate-700 text-[13px] text-slate-400">
              Select a thread to view it
            </div>
          )}
        </div>
      )}

      {composing && (
        <NewThreadModal
          systems={workspace.systemsInScope.map((s) => ({ id: s.id, name: s.name }))}
          runs={workspace.reviewItems.map((r) => ({ id: r.run.id, label: `${r.systemName} · run ${shortId(r.run.id)}` }))}
          onClose={() => setComposing(false)}
          onCreate={(payload) => {
            const id = addThread({ ...payload, author });
            setSelectedId(id);
            setComposing(false);
          }}
        />
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────── list bits ── */

function FilterChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        "rounded-full px-2.5 py-1 text-[11px] font-semibold transition-colors",
        active
          ? "bg-brand-600 text-white"
          : "bg-white dark:bg-slate-800 text-slate-500 dark:text-slate-400 ring-1 ring-black/5 dark:ring-white/10 hover:bg-slate-50 dark:hover:bg-slate-700",
      )}
    >
      {label}
    </button>
  );
}

function ThreadListItem({ thread: t, active, onClick }: { thread: CollabThread; active: boolean; onClick: () => void }) {
  const meta = KIND_META[t.kind];
  const Icon = meta.icon;
  return (
    <button
      onClick={onClick}
      className={clsx(
        "flex w-full flex-col gap-1 rounded-lg border px-3 py-2.5 text-left transition-colors",
        active
          ? "border-brand-500 bg-brand-50/60 dark:border-brand-500 dark:bg-brand-950/30"
          : "border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800/60",
      )}
    >
      <div className="flex items-center gap-2">
        <Icon className={clsx("h-3.5 w-3.5 shrink-0", meta.tone)} />
        <p className="min-w-0 flex-1 truncate text-[13px] font-semibold text-ink dark:text-white">{t.subject}</p>
        {t.status === "resolved" && <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-500" />}
      </div>
      <div className="flex items-center justify-between text-[11px] text-slate-400">
        <span className="truncate">{t.scopeLabel}</span>
        <span className="shrink-0">
          {t.messages.length} msg · {timeAgo(t.updatedAt)}
        </span>
      </div>
    </button>
  );
}

/* ────────────────────────────────────────────────────────── detail ── */

function ThreadDetail({
  thread: t,
  reply,
  onReply,
  onSubmit,
  onToggleStatus,
  onRemove,
}: {
  thread: CollabThread;
  reply: string;
  onReply: (v: string) => void;
  onSubmit: () => void;
  onToggleStatus: () => void;
  onRemove: () => void;
}) {
  const meta = KIND_META[t.kind];
  const Icon = meta.icon;
  const resolved = t.status === "resolved";
  return (
    <div className="flex min-h-[52vh] flex-col rounded-xl bg-white dark:bg-slate-900 shadow-card ring-1 ring-black/3 dark:ring-white/6">
      {/* header */}
      <div className="flex items-start justify-between gap-3 border-b border-slate-100 dark:border-slate-800 px-5 py-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Icon className={clsx("h-4 w-4 shrink-0", meta.tone)} />
            <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
              {meta.label} · {t.scopeType}
            </span>
            <span
              className={clsx(
                "rounded px-1.5 py-0.5 text-[10px] font-semibold capitalize",
                resolved
                  ? "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400"
                  : "bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400",
              )}
            >
              {t.status}
            </span>
          </div>
          <h2 className="mt-1 truncate font-display text-[17px] text-ink dark:text-white">{t.subject}</h2>
          <p className="mt-0.5 truncate text-[12px] text-slate-500 dark:text-slate-400">{t.scopeLabel}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            onClick={onToggleStatus}
            className={clsx(
              "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12px] font-medium transition-colors",
              resolved
                ? "border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
                : "border-emerald-200 dark:border-emerald-900/50 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/40",
            )}
          >
            {resolved ? <RotateCcw className="h-3.5 w-3.5" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
            {resolved ? "Reopen" : "Resolve"}
          </button>
          <button
            onClick={onRemove}
            aria-label="Delete thread"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* messages */}
      <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
        {t.messages.map((m) => (
          <div key={m.id} className="flex gap-3">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 dark:bg-slate-800 text-[11px] font-semibold text-slate-600 dark:text-slate-300">
              {m.authorInitials}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2">
                <span className="text-[13px] font-semibold text-ink dark:text-white">{m.author}</span>
                <span className="text-[11px] text-slate-400">{timeAgo(m.createdAt)}</span>
              </div>
              <p className="mt-0.5 whitespace-pre-wrap text-[13px] leading-relaxed text-slate-600 dark:text-slate-300">
                {m.body}
              </p>
            </div>
          </div>
        ))}
      </div>

      {/* composer */}
      <div className="border-t border-slate-100 dark:border-slate-800 px-5 py-3.5">
        <div className="flex items-end gap-2">
          <textarea
            value={reply}
            onChange={(e) => onReply(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") onSubmit();
            }}
            rows={2}
            placeholder={t.kind === "query" ? "Reply to this query…" : "Add a note…"}
            className="flex-1 resize-none rounded-lg border border-slate-200 dark:border-slate-700 bg-transparent px-3 py-2 text-[13px] text-ink dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-brand-500"
          />
          <button
            onClick={onSubmit}
            disabled={!reply.trim()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3.5 py-2.5 text-[13px] font-semibold text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Send className="h-4 w-4" />
            Send
          </button>
        </div>
        <p className="mt-1.5 text-[10px] text-slate-400">⌘/Ctrl + Enter to send</p>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────── empty ── */

function EmptyThreads({ onNew }: { onNew: () => void }) {
  return (
    <div className="flex min-h-[42vh] items-center justify-center">
      <div className="max-w-lg rounded-2xl border border-dashed border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 p-10 text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400">
          <MessagesSquare className="h-6 w-6" />
        </div>
        <h2 className="font-display text-[18px] text-ink dark:text-white">No notes or queries yet</h2>
        <p className="mx-auto mt-2 max-w-md text-[13px] leading-relaxed text-slate-500 dark:text-slate-400">
          Start a thread to keep review notes against a system or run, or to raise a clarification query to a
          system owner. Threads track status and keep a full reply history.
        </p>
        <button
          onClick={onNew}
          className="mt-5 inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-[13px] font-semibold text-white hover:bg-brand-700"
        >
          <Plus className="h-4 w-4" />
          New thread
        </button>
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────── new-thread modal ── */

function NewThreadModal({
  systems,
  runs,
  onClose,
  onCreate,
}: {
  systems: { id: string; name: string }[];
  runs: { id: string; label: string }[];
  onClose: () => void;
  onCreate: (payload: {
    kind: ThreadKind;
    scopeType: ThreadScopeType;
    scopeId: string;
    scopeLabel: string;
    subject: string;
    body: string;
  }) => void;
}) {
  const [kind, setKind] = useState<ThreadKind>("note");
  const [scopeType, setScopeType] = useState<ThreadScopeType>("system");
  const [scopeId, setScopeId] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");

  const scopeOptions = scopeType === "system" ? systems.map((s) => ({ id: s.id, label: s.name })) : runs;
  const scopeLabel = scopeOptions.find((o) => o.id === scopeId)?.label ?? "";
  const canCreate = scopeId && subject.trim() && body.trim();

  function submit() {
    if (!canCreate) return;
    onCreate({ kind, scopeType, scopeId, scopeLabel, subject: subject.trim(), body: body.trim() });
  }

  return (
    <AuditorModal
      title="New thread"
      subtitle="A review note or a clarification query, scoped to a system or run"
      onClose={onClose}
      footer={
        <>
          <button
            onClick={onClose}
            className="flex-1 rounded border border-slate-300 py-2.5 text-[13px] font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            Cancel
          </button>
          <button
            disabled={!canCreate}
            onClick={submit}
            className="flex-1 rounded bg-brand-600 py-2.5 text-[13px] font-semibold text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Create thread
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Type
            </label>
            <div className="flex gap-1.5">
              {(["note", "query"] as ThreadKind[]).map((k) => {
                const Icon = KIND_META[k].icon;
                return (
                  <button
                    key={k}
                    onClick={() => setKind(k)}
                    className={clsx(
                      "flex flex-1 items-center justify-center gap-1.5 rounded-md border py-1.5 text-[12px] font-semibold transition-colors",
                      kind === k
                        ? "border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-950/40 dark:text-brand-400"
                        : "border-slate-200 text-slate-500 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800",
                    )}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {KIND_META[k].label}
                  </button>
                );
              })}
            </div>
          </div>
          <div>
            <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Scope
            </label>
            <div className="flex gap-1.5">
              {(["system", "run"] as ThreadScopeType[]).map((s) => (
                <button
                  key={s}
                  onClick={() => {
                    setScopeType(s);
                    setScopeId("");
                  }}
                  className={clsx(
                    "flex-1 rounded-md border py-1.5 text-[12px] font-semibold capitalize transition-colors",
                    scopeType === s
                      ? "border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-950/40 dark:text-brand-400"
                      : "border-slate-200 text-slate-500 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800",
                  )}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div>
          <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            {scopeType === "system" ? "System" : "Run"}
          </label>
          <select
            value={scopeId}
            onChange={(e) => setScopeId(e.target.value)}
            className="w-full rounded-md border border-slate-200 dark:border-slate-700 bg-transparent px-2.5 py-2 text-[13px] text-ink dark:text-white focus:outline-none focus:ring-1 focus:ring-brand-500"
          >
            <option value="">
              {scopeOptions.length ? `Select a ${scopeType}…` : `No ${scopeType}s in scope`}
            </option>
            {scopeOptions.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Subject
          </label>
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder={kind === "query" ? "What needs clarifying?" : "What's the note about?"}
            className="w-full rounded-md border border-slate-200 dark:border-slate-700 bg-transparent px-3 py-2 text-[13px] text-ink dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-brand-500"
          />
        </div>

        <div>
          <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            {kind === "query" ? "Query" : "Note"}
          </label>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={3}
            placeholder={kind === "query" ? "Describe what you need from the system owner…" : "Your review note…"}
            className="w-full resize-none rounded-md border border-slate-200 dark:border-slate-700 bg-transparent px-3 py-2 text-[13px] text-ink dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-brand-500"
          />
        </div>
      </div>
    </AuditorModal>
  );
}
