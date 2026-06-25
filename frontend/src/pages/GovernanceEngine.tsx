const engineUrl = "/aegis-governance-engine.html";

export function GovernanceEngine() {
  return (
    <div className="bg-[#f6f7fb]">
      <iframe
        title="Aegis Governance Engine"
        src={engineUrl}
        className="block h-[calc(100vh-3.5rem)] w-full border-0 bg-transparent"
      />
    </div>
  );
}
