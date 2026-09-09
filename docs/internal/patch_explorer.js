const fs = require('fs');
const file = 'src/components/panels/ExplorerPanel.tsx';
let content = fs.readFileSync(file, 'utf8');

// 1. Add FilePlus2, FolderPlus to imports from "../icons"
if (!content.includes('FilePlus2')) {
    content = content.replace(/FolderX,\n\s*Clock,/, "FolderX,\n  Clock,\n  FilePlus2,\n  FolderPlus,");
}

// 2. Add state to ExplorerPanel
if (!content.includes('const [creating,')) {
    const stateHook = `  const [analyzed, setAnalyzed] = useState<string | null>(null);`;
    content = content.replace(stateHook, `${stateHook}\n  const [creating, setCreating] = useState<"file" | "dir" | null>(null);\n  const [createName, setCreateName] = useState("");`);
}

// 3. Add finishCreate function
if (!content.includes('finishCreate')) {
    const analyzeFunc = `  const analyze = async () => {`;
    const finishCreateFunc = `
  const finishCreate = async () => {
    if (!creating || !createName.trim() || !workspaceRoot) return;
    const name = createName.trim();
    // basic path join
    const fullPath = workspaceRoot + (workspaceRoot.endsWith("/") ? "" : "/") + name;
    try {
      if (creating === "file") {
        await api.toolWriteFile(fullPath, "");
      } else {
        await api.toolCreateDir(fullPath);
      }
      refreshExplorer();
    } catch (e: any) {
      alert("Error: " + e);
    }
    setCreating(null);
    setCreateName("");
  };
`;
    content = content.replace(analyzeFunc, `${finishCreateFunc}\n${analyzeFunc}`);
}

// 4. Add buttons to header
if (!content.includes('onClick={() => setCreating("file")}')) {
    const headerTitle = `<span className="panel-title flex-1 truncate" title={workspaceRoot}>\n          {rootName}\n        </span>`;
    const newButtons = `
        <button className="icon-btn" title={t("newFile") || "New File"} onClick={() => { setCreating("file"); setCreateName(""); }}>
          <FilePlus2 size={14} />
        </button>
        <button className="icon-btn" title={t("newFolder") || "New Folder"} onClick={() => { setCreating("dir"); setCreateName(""); }}>
          <FolderPlus size={14} />
        </button>`;
    content = content.replace(headerTitle, `${headerTitle}${newButtons}`);
}

// 5. Add inline input UI
if (!content.includes('value={createName}')) {
    const analyzingCondition = `{analyzing && (`;
    const inlineInput = `
      {creating && (
        <div className="flex items-center gap-2 border-b border-[var(--color-border)] px-3 py-1.5">
          {creating === "file" ? <FilePlus2 size={13} className="opacity-70" /> : <FolderPlus size={13} className="opacity-70" />}
          <input
            autoFocus
            className="input w-full bg-[var(--color-surface-2)] text-[length:var(--fs-xs)] px-1.5 py-0.5 min-h-[22px]"
            placeholder={creating === "file" ? "File name..." : "Folder name..."}
            value={createName}
            onChange={(e) => setCreateName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void finishCreate();
              if (e.key === "Escape") setCreating(null);
            }}
            onBlur={() => setCreating(null)}
          />
        </div>
      )}
`;
    content = content.replace(analyzingCondition, `${inlineInput}\n      ${analyzingCondition}`);
}

fs.writeFileSync(file, content);
console.log("Patched ExplorerPanel.tsx");
