import { useEffect, useState } from "react";
import { db } from "../lib/db";
import { useStore } from "../lib/store";
import { KnowledgeNode, KnowledgeEdge } from "../lib/types";
import { Network, Database } from "lucide-react";

export function KnowledgeGraphView() {
  const activeProjectId = useStore((s) => s.activeProjectId);
  const [nodes, setNodes] = useState<KnowledgeNode[]>([]);
  const [edges, setEdges] = useState<KnowledgeEdge[]>([]);

  useEffect(() => {
    if (!activeProjectId) {
      setNodes([]);
      setEdges([]);
      return;
    }
    db.listKnowledgeNodes(activeProjectId).then(setNodes).catch(console.error);
    db.listKnowledgeEdges(activeProjectId).then(setEdges).catch(console.error);
  }, [activeProjectId]);

  if (!activeProjectId) {
    return (
      <div className="flex h-full w-full items-center justify-center text-[var(--color-text-dim)]">
        <div className="text-center">
          <Network size={48} className="mx-auto mb-4 opacity-20" />
          <p>Select a project to view its Knowledge Graph</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full w-full flex-col p-8 overflow-y-auto">
      <h1 className="text-2xl font-semibold text-[var(--color-text)] flex items-center gap-2">
        <Network size={24} /> Knowledge Graph
      </h1>
      <p className="mt-2 text-[var(--color-text-dim)]">
        Contextual entities and their relationships.
      </p>

      <div className="mt-8 grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div>
          <h2 className="font-medium text-[var(--color-text)] mb-4 flex items-center gap-2">
            <Database size={16} /> Nodes ({nodes.length})
          </h2>
          <div className="space-y-2">
            {nodes.length === 0 && <p className="text-sm text-[var(--color-text-dim)]">No nodes extracted yet.</p>}
            {nodes.map(n => (
              <div key={n.id} className="p-3 border border-[var(--color-border)] rounded-lg bg-[var(--color-surface)]">
                <div className="flex justify-between items-center mb-1">
                  <span className="font-medium text-sm text-[var(--color-text)]">{n.title}</span>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-[var(--color-surface-2)] text-[var(--color-text-dim)]">{n.nodeType}</span>
                </div>
                {n.summary && <p className="text-xs text-[var(--color-text-dim)] mt-2">{n.summary}</p>}
              </div>
            ))}
          </div>
        </div>

        <div>
          <h2 className="font-medium text-[var(--color-text)] mb-4 flex items-center gap-2">
            <Network size={16} /> Edges ({edges.length})
          </h2>
          <div className="space-y-2">
            {edges.length === 0 && <p className="text-sm text-[var(--color-text-dim)]">No relationships mapped yet.</p>}
            {edges.map((e, idx) => {
              const src = nodes.find(x => x.id === e.source)?.title || e.source;
              const tgt = nodes.find(x => x.id === e.target)?.title || e.target;
              return (
                <div key={idx} className="p-2 border border-[var(--color-border)] rounded-lg bg-[var(--color-surface)] text-sm flex items-center gap-2 text-[var(--color-text-dim)]">
                  <span className="text-[var(--color-text)]">{src}</span>
                  <span className="text-xs px-1.5 py-0.5 rounded bg-[var(--color-surface-2)]">{e.relation}</span>
                  <span className="text-[var(--color-text)]">{tgt}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
