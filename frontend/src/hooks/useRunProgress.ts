import { useEffect, useRef, useState } from "react";
import { API_BASE_URL } from "@/api/governanceApi";

export type AgentProgress = {
  name: string;
  status: string;
  finding_count: number;
  started_at: string | null;
  completed_at: string | null;
};

export type RunProgress = {
  run_id: string;
  status: string;
  current_phase: string;
  progress: number;
  agents: AgentProgress[];
  probe_count: number;
  finding_count: number;
  result_summary: Record<string, unknown>;
};

const PHASE_LABELS: Record<string, string> = {
  created: "Created",
  context_assembly: "Context Assembly",
  adaptive_orchestrator: "Evaluation Plan",
  metric_execution: "Metric Execution",
  specialist_agents: "Specialist Agents",
  deliberation_council: "Council Deliberation",
  action_reporting: "Action Reporting",
  completed: "Completed",
};

const PHASE_ORDER = Object.keys(PHASE_LABELS);

export function phaseLabel(phase: string): string {
  return PHASE_LABELS[phase] ?? phase;
}

export function phaseIndex(phase: string): number {
  return PHASE_ORDER.indexOf(phase);
}

// Cap reconnect backoff so a long-lived stream that drops keeps retrying at a
// steady cadence instead of giving up (the old behavior) or busy-looping.
const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 15000;

export function useRunProgress(runId: string | null) {
  const [progress, setProgress] = useState<RunProgress | null>(null);
  const [connected, setConnected] = useState(false);
  const esRef = useRef<EventSource | null>(null);
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attemptRef = useRef(0);

  useEffect(() => {
    if (!runId) {
      setProgress(null);
      setConnected(false);
      return;
    }

    let closed = false;
    const url = `${API_BASE_URL}/evaluation-runs/${runId}/progress/stream`;

    const connect = () => {
      if (closed) return;
      const es = new EventSource(url);
      esRef.current = es;

      es.onopen = () => {
        attemptRef.current = 0; // reset backoff once a connection succeeds
        setConnected(true);
      };

      es.onmessage = (event) => {
        try {
          setProgress(JSON.parse(event.data) as RunProgress);
        } catch {
          // ignore malformed events
        }
      };

      es.onerror = () => {
        // The browser fires onerror on transient drops. Instead of giving up
        // (which left the tiles frozen), close and reconnect with capped
        // exponential backoff so live progress recovers on its own.
        setConnected(false);
        es.close();
        if (closed) return;
        const delay = Math.min(
          RECONNECT_MAX_MS,
          RECONNECT_BASE_MS * 2 ** attemptRef.current,
        );
        attemptRef.current += 1;
        retryRef.current = setTimeout(connect, delay);
      };
    };

    connect();

    return () => {
      closed = true;
      if (retryRef.current) clearTimeout(retryRef.current);
      esRef.current?.close();
      setConnected(false);
    };
  }, [runId]);

  return { progress, connected };
}
