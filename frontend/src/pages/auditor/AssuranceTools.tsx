import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  ArrowLeft,
  Bot,
  BookOpen,
  Image as ImageIcon,
  Lock,
  Scale,
  ShieldAlert,
  Waves,
  Wrench,
} from "lucide-react";
import clsx from "clsx";
import { getSecurityTools, type SecurityAdapterStatus, type SecurityToolsStatus } from "@/api/governanceApi";
import { useAppStore } from "@/store/useAppStore";
import { useSelectionStore } from "@/store/useSelectionStore";
import { AuditorPageHeader, BackendError } from "./components";

function BackToApplication() {
  const navigateTo = useAppStore((s) => s.navigateTo);
  const selectedSystemId = useSelectionStore((s) => s.selectedSystemId);
  return (
    <button
      onClick={() => navigateTo(selectedSystemId ? "/application" : "/applications")}
      className="inline-flex items-center gap-1.5 text-[12px] font-medium text-slate-500 dark:text-slate-400 hover:text-ink dark:hover:text-white"
    >
      <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
      Back
    </button>
  );
}

/**
 * Assurance tools & methods — auditor-facing view of the independent checks and
 * adapters that assess applications. The engine's real adapter inventory
 * (GET /security-tools) drives the list; each is re-described from the auditor's
 * point of view — WHAT it verifies and why it matters, not the technical tool
 * identity or its Python dependency. Read-only. Availability is honest: a method
 * that would not run is shown as "Not currently active", never implied as applied.
 */

type Framing = { title: string; blurb: string; icon: typeof Wrench };

// Auditor-POV framing keyed by the engine adapter key. Factual descriptions of
// what each method verifies. Unknown keys fall back to the engine's own
// category + description, so a newly added adapter still renders honestly.
const FRAMING: Record<string, Framing> = {
  garak: {
    title: "Adversarial & jailbreak testing",
    blurb: "Launches real jailbreak, prompt-injection and data-exfiltration attempts against the application to confirm it resists misuse and does not reveal restricted information.",
    icon: ShieldAlert,
  },
  pyrit: {
    title: "Red-team attack simulation",
    blurb: "Generates disguised attack prompts (encodings, character tricks and obfuscation) and probes the application to test its resilience against evasive, determined misuse.",
    icon: ShieldAlert,
  },
  presidio: {
    title: "Privacy & data-leakage detection",
    blurb: "Scans the application's responses for personal or sensitive information — names, emails, credentials and financial identifiers — to confirm nothing is unintentionally disclosed.",
    icon: Lock,
  },
  deepeval: {
    title: "Safety, fairness & answer-quality review",
    blurb: "An independent AI reviewer judges responses for bias, toxicity, unsafe compliance and whether answers actually meet the required standard for the task.",
    icon: Scale,
  },
  ragas: {
    title: "Answer grounding & citation accuracy",
    blurb: "Checks that answers are supported by the approved knowledge sources and that any citations are correct — confirming the system is not fabricating information.",
    icon: BookOpen,
  },
  inspect_ai: {
    title: "Agent & tool-use safety",
    blurb: "Runs agent scenarios to confirm the application refuses unsafe or unauthorized actions and stays within the tools and permissions it is allowed to use.",
    icon: Bot,
  },
  vision: {
    title: "Image & visual-content safety",
    blurb: "Reviews image inputs and outputs for unsafe, sensitive or non-compliant visual content.",
    icon: ImageIcon,
  },
  audio: {
    title: "Voice & transcription accuracy",
    blurb: "Checks speech-to-text accuracy for voice interfaces so spoken interactions are captured and handled reliably.",
    icon: Waves,
  },
  langfuse: {
    title: "Operational monitoring & traceability",
    blurb: "Observes live production behaviour — escalations, human overrides and decision traces. Provided as operational evidence for review rather than an automated pass/fail test.",
    icon: Activity,
  },
  evidently: {
    title: "Stability & drift monitoring",
    blurb: "Watches for performance drift and inconsistent behaviour over time, so degradations are surfaced for review. Provided as monitoring evidence rather than a one-off test.",
    icon: Activity,
  },
};

type StatusMeta = { label: string; tone: "active" | "evidence" | "idle"; note: string };

function auditorStatus(a: SecurityAdapterStatus): StatusMeta {
  if (a.available) return { label: "Active", tone: "active", note: "Applied in assessments." };
  if (a.kind === "tracing") return { label: "Operational evidence", tone: "evidence", note: "Reviewed as monitoring evidence, not an automated test." };
  return { label: "Not currently active", tone: "idle", note: "Available once enabled on the engineering side." };
}

const TONE_CLS: Record<StatusMeta["tone"], { dot: string; pill: string }> = {
  active: { dot: "bg-emerald-500", pill: "text-emerald-700 bg-emerald-50 dark:text-emerald-300 dark:bg-emerald-950/40" },
  evidence: { dot: "bg-blue-400", pill: "text-blue-700 bg-blue-50 dark:text-blue-300 dark:bg-blue-950/40" },
  idle: { dot: "bg-slate-300 dark:bg-slate-600", pill: "text-slate-500 bg-slate-100 dark:text-slate-400 dark:bg-slate-800" },
};

export function AssuranceTools() {
  const [data, setData] = useState<SecurityToolsStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [token, setToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(null);
    getSecurityTools()
      .then((d) => { if (!cancelled) setData(d); })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : "Could not load assurance tools."); });
    return () => { cancelled = true; };
  }, [token]);

  const activeCount = useMemo(() => (data?.adapters ?? []).filter((a) => a.available).length, [data]);

  if (error) {
    return (
      <div className="space-y-5">
        <AuditorPageHeader eyebrow="Assurance" title="Assurance tools & methods" />
        <BackendError message={error} onRetry={() => setToken((v) => v + 1)} />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <BackToApplication />
      <AuditorPageHeader
        eyebrow="Assurance"
        title="Assurance tools & methods"
        description="The independent checks used to assess your applications — what each one verifies. Availability reflects the current engine configuration."
        connected={Boolean(data)}
        onRefresh={() => setToken((v) => v + 1)}
      />

      {!data ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-[132px] animate-pulse rounded-2xl border border-hairline dark:border-white/10 bg-slate-50 dark:bg-slate-800/40" />
          ))}
        </div>
      ) : (
        <>
          <p className="text-[12px] text-slate-500 dark:text-slate-400">
            <span className="font-semibold text-ink dark:text-slate-200">{data.adapters.length}</span> assurance methods ·{" "}
            <span className="font-semibold text-emerald-600 dark:text-emerald-400">{activeCount}</span> active in current assessments
          </p>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {data.adapters.map((a) => <MethodCard key={a.key} adapter={a} />)}
          </div>
          <p className="rounded-lg border border-dashed border-slate-300 dark:border-slate-700 px-3 py-2 text-[11px] leading-relaxed text-slate-400 dark:text-slate-500">
            Each method is an independent check applied during an assessment. “Active” methods run automatically against the
            application; “operational evidence” methods provide monitoring signals reviewed by a person. A method that is not
            active is never counted as passed.
          </p>
        </>
      )}
    </div>
  );
}

function MethodCard({ adapter }: { adapter: SecurityAdapterStatus }) {
  const framing = FRAMING[adapter.key];
  const title = framing?.title ?? adapter.category;
  const blurb = framing?.blurb ?? adapter.description;
  const Icon = framing?.icon ?? Wrench;
  const status = auditorStatus(adapter);
  const tone = TONE_CLS[status.tone];

  return (
    <div className="flex h-full flex-col rounded-2xl border border-hairline dark:border-white/10 bg-white dark:bg-slate-900 p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400">
            <Icon className="h-4 w-4" aria-hidden />
          </span>
          <div className="min-w-0">
            <p className="text-[14px] font-semibold leading-snug text-ink dark:text-white">{title}</p>
            <p className="mt-0.5 text-[11px] font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">{adapter.category}</p>
          </div>
        </div>
        <span className={clsx("inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold", tone.pill)}>
          <span className={clsx("h-1.5 w-1.5 rounded-full", tone.dot)} aria-hidden />
          {status.label}
        </span>
      </div>

      <p className="mt-3 text-[13px] leading-relaxed text-slate-600 dark:text-slate-300">{blurb}</p>

      <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-hairline dark:border-white/10 pt-3">
        <span className="text-[11px] text-slate-400 dark:text-slate-500">{status.note}</span>
        <span className="text-[11px] text-slate-400 dark:text-slate-500">Method: <span className="font-medium text-slate-500 dark:text-slate-400">{adapter.name}</span></span>
      </div>
    </div>
  );
}
