import { useEffect, useRef, useState } from "react";

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

const API_BASE = "http://localhost:8000/api/v1";

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

export function useRunProgress(runId: string | null) {
  const [progress, setProgress] = useState<RunProgress | null>(null);
  const [connected, setConnected] = useState(false);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!runId) return;

    const url = `${API_BASE}/evaluation-runs/${runId}/progress/stream`;
    const es = new EventSource(url);
    esRef.current = es;
    setConnected(true);

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as RunProgress;
        setProgress(data);
      } catch {
        // ignore malformed events
      }
    };

    es.onerror = () => {
      setConnected(false);
      es.close();
    };

    return () => {
      es.close();
      setConnected(false);
    };
  }, [runId]);

  return { progress, connected };
}
