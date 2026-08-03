import { useMemo, useState } from "react";
import {
  ArrowRight,
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  Inbox,
  ListChecks,
  Plus,
  Trash2,
} from "lucide-react";
import clsx from "clsx";
import { useAppStore } from "@/store/useAppStore";
import { useSelectionStore } from "@/store/useSelectionStore";
import { useAuditorWorkspace, type ReviewItem } from "@/hooks/useAuditorWorkspace";
import {
  useAuditorCollabStore,
  type Assignment,
  type AssignmentStatus,
  type Priority,
} from "@/store/useAuditorCollabStore";
import {
  AuditorModal,
  AuditorPageHeader,
  DemoDataBanner,
  VerdictTag,
  formatDueDate,
  isOverdue,
  shortId,
} from "./components";

/**
 * My Assignments — the auditor's personal review worklist. There is no backend
 * assignments table or authenticated auditor identity yet, so this is a
 * frontend-only interactive layer (see useAuditorCollabStore): the auditor can
 * actually assign runs to themselves, prioritise, set due dates, and move them
 * across a To do → In review → Done board. Data lives in this browser only.
 */

const COLUMNS: { status: AssignmentStatus; label: string; hint: string }[] = [
  { status: "todo", label: "To do", hint: "Not started" },
  { status: "in_review", label: "In review", hint: "Actively reviewing" },
  { status: "done", label: "Done", hint: "Review complete" },
];

const PRIORITIES: Priority[] = ["high", "medium", "low"];

export function MyAssignments() {
  const navigateTo = useAppStore((s) => s.navigateTo);
  const focusRun = useSelectionStore((s) => s.focusRun);
  const workspace = useAuditorWorkspace();
  const assignments = useAuditorCollabStore((s) => s.assignments);
  const addAssignment = useAuditorCollabStore((s) => s.addAssignment);
  const updateAssignment = useAuditorCollabStore((s) => s.updateAssignment);
  const removeAssignment = useAuditorCollabStore((s) => s.removeAssignment);

  const [picking, setPicking] = useState(false);

  const byStatus = useMemo(() => {
    const groups: Record<AssignmentStatus, Assignment[]> = { todo: [], in_review: [], done: [] };
    for (const a of assignments) groups[a.status].push(a);
    return groups;
  }, [assignments]);

  const overdueCount = assignments.filter((a) => a.status !== "done" && isOverdue(a.dueDate)).length;
  const assignedRunIds = useMemo(() => new Set(assignments.map((a) => a.runId)), [assignments]);

  function openRun(a: Assignment) {
    focusRun(a.runId, a.systemId);
    navigateTo("/review-queue");
  }

  function move(a: Assignment, dir: -1 | 1) {
    const idx = COLUMNS.findIndex((c) => c.status === a.status);
    const next = COLUMNS[idx + dir];
    if (next) updateAssignment(a.id, { status: next.status });
  }

  const kpis = [
    { label: "To do", value: byStatus.todo.length },
    { label: "In review", value: byStatus.in_review.length },
    { label: "Done", value: byStatus.done.length },
    { label: "Overdue", value: overdueCount, danger: overdueCount > 0 },
  ];

  return (
    <div className="space-y-5">
      <AuditorPageHeader
        eyebrow="My workspace"
        title="My Assignments"
        description="Your personal review worklist — assign runs in scope to yourself, prioritise, and track them to completion."
        action={
          <button
            onClick={() => setPicking(true)}
            className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-3.5 py-2 text-[13px] font-semibold text-white hover:bg-brand-700"
          >
            <Plus className="h-4 w-4" />
            Assign a run
          </button>
        }
      />

      <DemoDataBanner>
        Local-only interactive preview. There's no backend assignments table or auditor identity yet, so
        these assignments are saved in <strong>this browser only</strong> — not on the server and not shared
        with other auditors. The workflow is fully functional so it can be demonstrated end-to-end.
      </DemoDataBanner>

      {assignments.length === 0 ? (
        <EmptyAssignments onAssign={() => setPicking(true)} onQueue={() => navigateTo("/review-queue")} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {kpis.map((k) => (
              <div
                key={k.label}
                className="rounded-xl bg-white dark:bg-slate-900 px-4 py-3 shadow-card ring-1 ring-black/3 dark:ring-white/6"
              >
                <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">{k.label}</p>
                <p
                  className={clsx(
                    "mt-1 font-display text-[24px] leading-none",
                    k.danger ? "text-red-600 dark:text-red-400" : "text-ink dark:text-white",
                  )}
                >
                  {k.value}
                </p>
              </div>
            ))}
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            {COLUMNS.map((col) => (
              <div key={col.status} className="rounded-xl bg-slate-50/70 dark:bg-slate-800/30 p-3">
                <div className="mb-3 flex items-center justify-between px-1">
                  <div>
                    <p className="text-[13px] font-semibold text-ink dark:text-white">{col.label}</p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">{col.hint}</p>
                  </div>
                  <span className="rounded-full bg-white dark:bg-slate-800 px-2 py-0.5 text-[11px] font-semibold text-slate-500 dark:text-slate-400 ring-1 ring-black/5 dark:ring-white/10">
                    {byStatus[col.status].length}
                  </span>
                </div>
                <div className="space-y-2.5">
                  {byStatus[col.status].length === 0 ? (
                    <p className="rounded-lg border border-dashed border-slate-200 dark:border-slate-700 px-3 py-6 text-center text-[12px] text-slate-400">
                      Nothing here
                    </p>
                  ) : (
                    byStatus[col.status].map((a) => (
                      <AssignmentCard
                        key={a.id}
                        assignment={a}
                        canMoveLeft={col.status !== "todo"}
                        canMoveRight={col.status !== "done"}
                        onMove={(dir) => move(a, dir)}
                        onPriority={(p) => updateAssignment(a.id, { priority: p })}
                        onOpen={() => openRun(a)}
                        onRemove={() => removeAssignment(a.id)}
                      />
                    ))
                  )}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {picking && (
        <AssignRunModal
          reviewItems={workspace.reviewItems}
          loading={workspace.loading}
          alreadyAssigned={assignedRunIds}
          onClose={() => setPicking(false)}
          onAssign={(payload) => {
            addAssignment(payload);
            setPicking(false);
          }}
        />
      )}
    </div>
  );
}

/* ──────────────────────────────────────────────────────────── card ── */

function AssignmentCard({
  assignment: a,
  canMoveLeft,
  canMoveRight,
  onMove,
  onPriority,
  onOpen,
  onRemove,
}: {
  assignment: Assignment;
  canMoveLeft: boolean;
  canMoveRight: boolean;
  onMove: (dir: -1 | 1) => void;
  onPriority: (p: Priority) => void;
  onOpen: () => void;
  onRemove: () => void;
}) {
  const overdue = a.status !== "done" && isOverdue(a.dueDate);
  return (
    <div className="rounded-lg bg-white dark:bg-slate-900 p-3 shadow-sm ring-1 ring-black/5 dark:ring-white/10">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-[13px] font-semibold text-ink dark:text-white">{a.systemName}</p>
          <p className="mt-0.5 font-mono text-[11px] text-slate-400">run {shortId(a.runId)}</p>
        </div>
        <select
          value={a.priority}
          onChange={(e) => onPriority(e.target.value as Priority)}
          aria-label="Priority"
          className="shrink-0 rounded border border-slate-200 dark:border-slate-700 bg-transparent px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300 focus:outline-none focus:ring-1 focus:ring-brand-500"
        >
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </div>

      {a.note && <p className="mt-2 line-clamp-3 text-[12px] leading-5 text-slate-600 dark:text-slate-400">{a.note}</p>}

      <div className="mt-2.5 flex items-center gap-1.5 text-[11px]">
        <CalendarClock className={clsx("h-3.5 w-3.5", overdue ? "text-red-500" : "text-slate-400")} />
        <span className={clsx(overdue ? "font-semibold text-red-600 dark:text-red-400" : "text-slate-500 dark:text-slate-400")}>
          {formatDueDate(a.dueDate)}
          {overdue && " · overdue"}
        </span>
      </div>

      <div className="mt-3 flex items-center justify-between border-t border-slate-100 dark:border-slate-800 pt-2.5">
        <div className="flex items-center gap-1">
          <button
            disabled={!canMoveLeft}
            onClick={() => onMove(-1)}
            aria-label="Move left"
            className="flex h-6 w-6 items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-30 disabled:hover:bg-transparent dark:hover:bg-slate-800"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            disabled={!canMoveRight}
            onClick={() => onMove(1)}
            aria-label="Move right"
            className="flex h-6 w-6 items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-30 disabled:hover:bg-transparent dark:hover:bg-slate-800"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={onOpen}
            className="inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium text-brand-700 hover:bg-brand-50 dark:text-brand-400 dark:hover:bg-brand-950/40"
          >
            Open
            <ArrowRight className="h-3 w-3" />
          </button>
          <button
            onClick={onRemove}
            aria-label="Remove assignment"
            className="flex h-6 w-6 items-center justify-center rounded text-slate-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────── empty ── */

function EmptyAssignments({ onAssign, onQueue }: { onAssign: () => void; onQueue: () => void }) {
  return (
    <div className="flex min-h-[42vh] items-center justify-center">
      <div className="max-w-lg rounded-2xl border border-dashed border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 p-10 text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400">
          <Inbox className="h-6 w-6" />
        </div>
        <h2 className="font-display text-[18px] text-ink dark:text-white">Your worklist is empty</h2>
        <p className="mx-auto mt-2 max-w-md text-[13px] leading-relaxed text-slate-500 dark:text-slate-400">
          Assign a run in scope to yourself to start tracking it. You can prioritise it, set a due date, and
          move it across your board as you review.
        </p>
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
          <button
            onClick={onAssign}
            className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-[13px] font-semibold text-white hover:bg-brand-700"
          >
            <Plus className="h-4 w-4" />
            Assign a run
          </button>
          <button
            onClick={onQueue}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-2 text-[13px] font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700"
          >
            <ListChecks className="h-4 w-4" />
            Browse Review Queue
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────── assign modal ── */

function AssignRunModal({
  reviewItems,
  loading,
  alreadyAssigned,
  onClose,
  onAssign,
}: {
  reviewItems: ReviewItem[];
  loading: boolean;
  alreadyAssigned: Set<string>;
  onClose: () => void;
  onAssign: (payload: {
    runId: string;
    systemId: string;
    systemName: string;
    priority: Priority;
    dueDate: string | null;
    note: string;
  }) => void;
}) {
  const available = useMemo(
    () => reviewItems.filter((r) => !alreadyAssigned.has(r.run.id)),
    [reviewItems, alreadyAssigned],
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [priority, setPriority] = useState<Priority>("medium");
  const [dueDate, setDueDate] = useState("");
  const [note, setNote] = useState("");

  const selected = available.find((r) => r.run.id === selectedId) ?? null;

  function submit() {
    if (!selected) return;
    onAssign({
      runId: selected.run.id,
      systemId: selected.systemId,
      systemName: selected.systemName,
      priority,
      dueDate: dueDate || null,
      note: note.trim(),
    });
  }

  return (
    <AuditorModal
      title="Assign a run to yourself"
      subtitle="Pick a run in scope and add it to your worklist"
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
            disabled={!selected}
            onClick={submit}
            className="flex-1 rounded bg-brand-600 py-2.5 text-[13px] font-semibold text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Assign to me
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Run
          </label>
          {loading ? (
            <p className="rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-6 text-center text-[12px] text-slate-400">
              Loading runs in scope…
            </p>
          ) : available.length === 0 ? (
            <p className="rounded-lg border border-dashed border-slate-200 dark:border-slate-700 px-3 py-6 text-center text-[12px] text-slate-500 dark:text-slate-400">
              Every run in scope is already on your worklist.
            </p>
          ) : (
            <div className="max-h-56 space-y-1.5 overflow-y-auto">
              {available.map((r) => {
                const active = r.run.id === selectedId;
                return (
                  <button
                    key={r.run.id}
                    onClick={() => setSelectedId(r.run.id)}
                    className={clsx(
                      "flex w-full items-center justify-between gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors",
                      active
                        ? "border-brand-500 bg-brand-50/60 dark:border-brand-500 dark:bg-brand-950/30"
                        : "border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800/60",
                    )}
                  >
                    <div className="min-w-0">
                      <p className="truncate text-[13px] font-semibold text-ink dark:text-white">{r.systemName}</p>
                      <p className="mt-0.5 font-mono text-[11px] text-slate-400">
                        run {shortId(r.run.id)} · {r.openFindings} open · {r.criticalHigh} crit/high
                      </p>
                    </div>
                    {r.verdictLabel && <VerdictTag label={r.verdictLabel} />}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Priority
            </label>
            <div className="flex gap-1.5">
              {PRIORITIES.map((p) => (
                <button
                  key={p}
                  onClick={() => setPriority(p)}
                  className={clsx(
                    "flex-1 rounded-md border py-1.5 text-[11px] font-semibold capitalize transition-colors",
                    priority === p
                      ? "border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-950/40 dark:text-brand-400"
                      : "border-slate-200 text-slate-500 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800",
                  )}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Due date <span className="font-normal normal-case text-slate-400">(optional)</span>
            </label>
            <input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="w-full rounded-md border border-slate-200 dark:border-slate-700 bg-transparent px-2.5 py-1.5 text-[13px] text-ink dark:text-white focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </div>
        </div>

        <div>
          <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Note <span className="font-normal normal-case text-slate-400">(optional)</span>
          </label>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            placeholder="Why you're picking this up, what to focus on…"
            className="w-full resize-none rounded-md border border-slate-200 dark:border-slate-700 bg-transparent px-3 py-2 text-[13px] text-ink dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-brand-500"
          />
        </div>
      </div>
    </AuditorModal>
  );
}
