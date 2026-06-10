import { useRef, useState } from "react";

const engineUrl = "/aegis-governance-engine.html";

export function GovernanceEngine() {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const reloadEngine = () => {
    setReloadKey((current) => current + 1);
  };

  return (
    <div className="overflow-hidden rounded-md border border-slate-200 bg-white shadow-sm">
      <button className="sr-only" onClick={reloadEngine}>
        Reload Governance Engine
      </button>
        <iframe
          key={reloadKey}
          ref={iframeRef}
          title="Aegis Governance Engine"
          src={engineUrl}
          className="h-[calc(100vh-178px)] min-h-[780px] w-full bg-white"
        />
    </div>
  );
}
