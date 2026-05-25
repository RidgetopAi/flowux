import {
  Check,
  CornerUpLeft,
  GitBranch,
  History,
  Import as ImportIcon,
  Layers,
  PanelLeftClose,
  PanelLeftOpen,
  Save,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { cn } from "../../lib/cn";
import { useCanvas } from "../../lib/store";
import { useFlowuxStore } from "../../store.js";
import { Button } from "../primitives/Button";
import { Label } from "../primitives/Label";
import { Pill } from "../primitives/Pill";
import "./Sidebar.css";

type Tab = "search" | "bundles" | "branches" | "imports" | "history";

const TABS: Array<{ id: Tab; icon: ReactNode; label: string }> = [
  { id: "search",   icon: <Search size={14} />,     label: "Search" },
  { id: "bundles",  icon: <Layers size={14} />,     label: "Bundles" },
  { id: "branches", icon: <GitBranch size={14} />,  label: "Branches" },
  { id: "imports",  icon: <ImportIcon size={14} />, label: "Imports" },
  { id: "history",  icon: <History size={14} />,    label: "History" },
];

export function Sidebar() {
  const [open, setOpen] = useState(true);
  const [tab, setTab] = useState<Tab>("search");

  return (
    <aside className={cn("sidebar", open ? "sidebar--open" : "sidebar--collapsed")}>
      <nav className="sidebar__rail" aria-label="Sidebar tabs">
        <button
          className="sidebar__rail-toggle"
          onClick={() => setOpen((o) => !o)}
          title={open ? "Collapse sidebar" : "Open sidebar"}
          aria-label={open ? "Collapse sidebar" : "Open sidebar"}
        >
          {open ? <PanelLeftClose size={14} /> : <PanelLeftOpen size={14} />}
        </button>
        {TABS.map((t) => (
          <button
            key={t.id}
            className={cn("sidebar__tab", tab === t.id && "sidebar__tab--active")}
            onClick={() => {
              setTab(t.id);
              if (!open) setOpen(true);
            }}
            title={t.label}
            aria-label={t.label}
            aria-current={tab === t.id ? "page" : undefined}
          >
            {t.icon}
          </button>
        ))}
      </nav>

      {open && (
        <div className="sidebar__body">
          <header className="sidebar__head">
            <Label size="micro" tone="cyan">
              {tab.toUpperCase()}
            </Label>
          </header>
          <div className="sidebar__pane">
            {tab === "search" && <SearchPanel />}
            {tab === "bundles" && <BundlesPanel />}
            {tab === "branches" && <BranchesPanel />}
            {tab === "imports" && <ImportsPanel />}
            {tab === "history" && <HistoryPanel />}
          </div>
        </div>
      )}
    </aside>
  );
}

/* ── Search ──────────────────────────────────────────────────────────── */
function SearchPanel() {
  const [query, setQuery] = useState("");
  const results = useFlowuxStore((s) => s.searchResults);
  const searchWorkspace = useFlowuxStore((s) => s.searchWorkspace);
  const switchCanvas = useFlowuxStore((s) => s.switchCanvas);
  const currentCanvasId = useFlowuxStore((s) => s.snapshot?.canvas.id);
  const revealMRP = useCanvas((s) => s.revealMRP);
  const setExpanded = useCanvas((s) => s.setExpanded);

  // Debounce the query → API call. 220ms feels responsive without spamming
  // the API on every keystroke.
  useEffect(() => {
    const id = window.setTimeout(() => void searchWorkspace(query), 220);
    return () => window.clearTimeout(id);
  }, [query, searchWorkspace]);

  const openResult = async (canvasId: string, mrpId?: string) => {
    if (canvasId !== currentCanvasId) {
      await switchCanvas(canvasId);
    }
    if (!mrpId) return;
    // After switch (or no-op), wait for the snapshot to settle so the new
    // canvas's placements are queryable, then locate placement.id by mrpId
    // and ask Canvas to expand + center.
    requestAnimationFrame(() => {
      const placement = useFlowuxStore
        .getState()
        .snapshot?.placements.find((p) => p.mrpId === mrpId);
      if (!placement) return;
      setExpanded(placement.id);
      revealMRP(placement.id);
    });
  };

  return (
    <div className="sidebar-section">
      <div className="sidebar-search">
        <Search size={13} className="sidebar-search__icon" aria-hidden="true" />
        <input
          className="sidebar-search__input"
          type="search"
          placeholder="canvases · MRPs · artifacts"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search workspace"
        />
        {query && (
          <button
            className="sidebar-search__clear"
            onClick={() => setQuery("")}
            aria-label="Clear search"
          >
            <X size={11} />
          </button>
        )}
      </div>

      {!query && (
        <div className="sidebar-empty">Type to search across the workspace.</div>
      )}
      {query && results.length === 0 && (
        <div className="sidebar-empty">— no matches —</div>
      )}
      {results.length > 0 && (
        <ul className="sidebar-list sidebar-list--scroll">
          {results.map((r) => (
            <li key={`${r.kind}-${r.id}`}>
              <button
                className="sidebar-search__result"
                onClick={() => void openResult(r.canvasId, r.mrpId)}
              >
                <div className="sidebar-search__result-head">
                  <Pill tone={r.kind === "mrp" ? "cyan" : r.kind === "canvas" ? "violet" : "amber"}>
                    {r.kind}
                  </Pill>
                  <span className="sidebar-search__result-title">{r.title}</span>
                </div>
                {r.snippet && (
                  <div className="sidebar-search__result-snippet">{r.snippet}</div>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ── Bundles (saved context sets) ────────────────────────────────────── */
function BundlesPanel() {
  const bundles = useFlowuxStore((s) => s.snapshot?.contextBundles ?? []);
  const placements = useFlowuxStore((s) => s.snapshot?.placements ?? []);
  const saveSelectedContextBundle = useFlowuxStore((s) => s.saveSelectedContextBundle);
  const applyContextBundle = useFlowuxStore((s) => s.applyContextBundle);
  const deleteContextBundle = useFlowuxStore((s) => s.deleteContextBundle);

  const selectedCount = placements.filter((p) => p.selectedForContext).length;

  const onSave = () => {
    if (selectedCount === 0) return;
    const name = window.prompt(
      "Name this context set",
      `Set ${bundles.length + 1}`,
    );
    if (name === null) return;
    void saveSelectedContextBundle(name.trim() || undefined);
  };

  return (
    <div className="sidebar-section">
      <div className="sidebar-section__head">
        <Label size="micro" tone="muted">
          {selectedCount} checked
        </Label>
        <Button
          size="sm"
          variant="ghost"
          icon={<Save size={13} />}
          onClick={onSave}
          disabled={selectedCount === 0}
          title="Save checked MRPs as a context set"
        >
          Save set
        </Button>
      </div>

      {bundles.length === 0 ? (
        <div className="sidebar-empty sidebar-empty--block">
          Check MRPs on the canvas, then save them as a named set you can
          reapply later.
        </div>
      ) : (
        <ul className="sidebar-list sidebar-list--scroll">
          {bundles.map((b) => (
            <li key={b.id} className="sidebar-bundle">
              <div className="sidebar-bundle__meta">
                <span className="sidebar-bundle__name">
                  {b.name || "Untitled set"}
                </span>
                <Pill>{b.selectedMrpIds.length}</Pill>
              </div>
              <div className="sidebar-bundle__actions">
                <Button
                  size="sm"
                  variant="ghost"
                  iconOnly
                  icon={<Check size={13} />}
                  onClick={() => void applyContextBundle(b.id)}
                  title="Apply this set"
                />
                <Button
                  size="sm"
                  variant="ghost"
                  iconOnly
                  icon={<Trash2 size={13} />}
                  onClick={() => void deleteContextBundle(b.id)}
                  title="Delete this set"
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ── Branches (parent / children of current canvas) ──────────────────── */
function BranchesPanel() {
  const snapshot = useFlowuxStore((s) => s.snapshot);
  const canvases = useFlowuxStore((s) => s.canvases);
  const switchCanvas = useFlowuxStore((s) => s.switchCanvas);
  const createChildCanvasFromSelection = useFlowuxStore(
    (s) => s.createChildCanvasFromSelection,
  );

  const parent = useMemo(() => {
    const parentId = snapshot?.canvas.parentCanvasId;
    return parentId ? canvases.find((c) => c.id === parentId) : undefined;
  }, [canvases, snapshot?.canvas.parentCanvasId]);

  const children = useMemo(() => {
    if (!snapshot) return [];
    return (snapshot.branches ?? [])
      .filter((b) => b.parentCanvasId === snapshot.canvas.id)
      .map((b) => canvases.find((c) => c.id === b.childCanvasId))
      .filter((c): c is NonNullable<typeof c> => Boolean(c));
  }, [snapshot, canvases]);

  const selectedCount = (snapshot?.placements ?? []).filter(
    (p) => p.selectedForContext,
  ).length;

  return (
    <div className="sidebar-section">
      <div className="sidebar-section__head">
        <Label size="micro" tone="muted">
          {selectedCount} checked
        </Label>
        <Button
          size="sm"
          variant="ghost"
          icon={<GitBranch size={13} />}
          onClick={() => void createChildCanvasFromSelection()}
          disabled={selectedCount === 0}
          title="Branch a new canvas from checked MRPs"
        >
          Branch
        </Button>
      </div>

      <section className="sidebar-branch-block">
        <Label size="micro" tone="muted">
          Parent
        </Label>
        {parent ? (
          <button
            className="sidebar-canvas-row"
            onClick={() => void switchCanvas(parent.id)}
            title="Open parent canvas"
          >
            <CornerUpLeft size={13} className="sidebar-canvas-row__glyph" />
            <span className="sidebar-canvas-row__title">{parent.title}</span>
          </button>
        ) : (
          <div className="sidebar-empty sidebar-empty--block">
            trunk — no parent canvas
          </div>
        )}
      </section>

      <section className="sidebar-branch-block">
        <Label size="micro" tone="muted">
          Children · {children.length}
        </Label>
        {children.length === 0 ? (
          <div className="sidebar-empty sidebar-empty--block">
            no child canvases yet
          </div>
        ) : (
          <ul className="sidebar-list">
            {children.map((c) => (
              <li key={c.id}>
                <button
                  className="sidebar-canvas-row"
                  onClick={() => void switchCanvas(c.id)}
                  title="Open this child canvas"
                >
                  <GitBranch size={13} className="sidebar-canvas-row__glyph" />
                  <span className="sidebar-canvas-row__title">{c.title}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/* ── History (sent prompts for this session, reusable) ───────────────── */
function HistoryPanel() {
  const promptHistory = useCanvas((s) => s.promptHistory);
  const setDockDraft = useCanvas((s) => s.setDockDraft);
  const openDock = useCanvas((s) => s.openDock);

  const reuse = (text: string) => {
    setDockDraft(text);
    openDock();
  };

  // Render newest-first — last sent is the most recently useful.
  const reversed = [...promptHistory].reverse();

  return (
    <div className="sidebar-section">
      {reversed.length === 0 ? (
        <div className="sidebar-empty sidebar-empty--block">
          No prompts sent yet this session. Sent prompts will appear here so you
          can re-stage them with one click.
        </div>
      ) : (
        <ul className="sidebar-list sidebar-list--scroll">
          {reversed.map((prompt, idx) => (
            <li key={`${promptHistory.length - idx - 1}-${prompt.slice(0, 32)}`}>
              <button
                className="sidebar-history__item"
                onClick={() => reuse(prompt)}
                title="Re-stage this prompt in the dock"
              >
                {prompt}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ── Imports (pull external MRP refs from another canvas) ────────────── */
function ImportsPanel() {
  const snapshot = useFlowuxStore((s) => s.snapshot);
  const canvases = useFlowuxStore((s) => s.canvases);
  const switchCanvas = useFlowuxStore((s) => s.switchCanvas);
  const importSelectedFromCanvas = useFlowuxStore(
    (s) => s.importSelectedFromCanvas,
  );

  const otherCanvases = (canvases ?? []).filter(
    (c) => c.id !== snapshot?.canvas.id,
  );

  return (
    <div className="sidebar-section">
      <div className="sidebar-empty sidebar-empty--block">
        Open a source canvas, check the MRPs you want, then come back here and
        pick that canvas to import its checked MRPs as external references.
      </div>
      {otherCanvases.length === 0 ? (
        <div className="sidebar-empty sidebar-empty--block">
          no other canvases to import from
        </div>
      ) : (
        <ul className="sidebar-list sidebar-list--scroll">
          {otherCanvases.map((c) => (
            <li key={c.id} className="sidebar-import-row">
              <button
                className="sidebar-canvas-row sidebar-canvas-row--flex"
                onClick={() => void switchCanvas(c.id)}
                title="Open this canvas to check MRPs"
              >
                <span className="sidebar-canvas-row__title">{c.title}</span>
              </button>
              <Button
                size="sm"
                variant="ghost"
                iconOnly
                icon={<ImportIcon size={13} />}
                onClick={() => void importSelectedFromCanvas(c.id)}
                title="Import checked MRPs from this canvas"
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
