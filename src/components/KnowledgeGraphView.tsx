import { useEffect, useState } from "react";
import { Network, Database, ArrowRight } from "./icons";
import { db } from "../lib/db";
import { useStore } from "../lib/store";
import { useT } from "../lib/i18n";
import { EmptyState } from "./ui/EmptyState";
import { PageHeader } from "./ui/PageHeader";
import type { KnowledgeNode, KnowledgeEdge } from "../lib/types";

export function KnowledgeGraphView() {
  const t = useT();
  const activeProjectId = useStore((s) => s.activeProjectId);
  const setCenterView = useStore((s) => s.setCenterView);
  const [nodes, setNodes] = useState<KnowledgeNode[]>([]);
  const [edges, setEdges] = useState<KnowledgeEdge[]>([]);

  useEffect(() => {
    if (!activeProjectId) {
      setNodes([]);
      setEdges([]);
      return;
    }
    db.listKnowledgeNodes(activeProjectId).then(setNodes).catch(() => setNodes([]));
    db.listKnowledgeEdges(activeProjectId).then(setEdges).catch(() => setEdges([]));
  }, [activeProjectId]);

  if (!activeProjectId) {
    return (
      <EmptyState
        icon={Network}
        title={t("kgNoProject")}
        action={{ label: t("projects"), onClick: () => setCenterView("projects") }}
      />
    );
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <PageHeader icon={Network} title={t("kgTitle")} subtitle={t("kgSubtitle")} />

      <div className="mx-auto grid w-full max-w-[1100px] grid-cols-1 gap-8 px-8 pb-10 lg:grid-cols-2">
        <section>
          <h2 className="mb-3 flex items-center gap-2 text-[length:var(--fs-base)] font-semibold">
            <Database size={15} className="text-[var(--color-text-dim)]" />
            {t("kgNodes")}
            <span className="badge">{nodes.length}</span>
          </h2>
          <div className="space-y-2">
            {nodes.length === 0 && (
              <p className="text-[length:var(--fs-base)] text-[var(--color-text-dim)]">
                {t("kgNoNodes")}
                <br />
                <span className="text-[length:var(--fs-sm)] text-[var(--color-text-mute)]">
                  {t("kgHint")}
                </span>
              </p>
            )}
            {nodes.map((n) => (
              <article key={n.id} className="panel p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-[length:var(--fs-base)] font-medium">
                    {n.title}
                  </span>
                  <span className="badge shrink-0">{n.nodeType}</span>
                </div>
                {n.summary && (
                  <p className="mt-1.5 text-[length:var(--fs-sm)] leading-relaxed text-[var(--color-text-dim)]">
                    {n.summary}
                  </p>
                )}
              </article>
            ))}
          </div>
        </section>

        <section>
          <h2 className="mb-3 flex items-center gap-2 text-[length:var(--fs-base)] font-semibold">
            <Network size={15} className="text-[var(--color-text-dim)]" />
            {t("kgEdges")}
            <span className="badge">{edges.length}</span>
          </h2>
          <div className="space-y-2">
            {edges.length === 0 && (
              <p className="text-[length:var(--fs-base)] text-[var(--color-text-dim)]">
                {t("kgNoEdges")}
              </p>
            )}
            {edges.map((e, i) => (
              <div
                key={`${e.source}-${e.target}-${i}`}
                className="panel flex items-center gap-2 p-2.5 text-[length:var(--fs-base)]"
              >
                <span className="truncate">
                  {nodes.find((x) => x.id === e.source)?.title ?? e.source}
                </span>
                <ArrowRight size={13} className="shrink-0 text-[var(--color-text-mute)]" />
                <span className="badge shrink-0" data-tone="accent">
                  {e.relation}
                </span>
                <ArrowRight size={13} className="shrink-0 text-[var(--color-text-mute)]" />
                <span className="truncate">
                  {nodes.find((x) => x.id === e.target)?.title ?? e.target}
                </span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
