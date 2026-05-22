import { rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { describe, expect, test } from "vitest";

describe("flowuxRepository phase 3 provenance", () => {
  test.skipIf(process.versions.modules !== "127")("creates a child canvas with selected MRPs as external references", async () => {
    const dbPath = join(tmpdir(), `flowux-phase3-${randomUUID()}.db`);
    process.env.FLOWUX_DB_PATH = dbPath;

    await import("../db/migrate.js");
    const repository = await import("./flowuxRepository.js");

    const parent = await repository.createCanvas("Phase 3 Parent");
    const created = await repository.createPromptMrp(parent.id, "source prompt", { layoutWidth: 900, rowHeight: 300 });
    await repository.completePromptMrp(parent.id, created.mrp.id, { response: "source response", finishReason: "stop" });
    await repository.updatePlacement(parent.id, created.mrp.id, { selectedForContext: true });

    const child = await repository.createChildCanvasFromSelection(parent.id);
    const parentSnapshot = await repository.getCanvasSnapshot(parent.id);
    const childSnapshot = await repository.getCanvasSnapshot(child.canvas.id);

    expect(child.branch.sourceMrpIds).toEqual([created.mrp.id]);
    expect(parentSnapshot?.branches.map((branch) => branch.id)).toContain(child.branch.id);
    expect(childSnapshot?.branches.map((branch) => branch.id)).toContain(child.branch.id);
    expect(childSnapshot?.placements).toContainEqual(
      expect.objectContaining({
        mrpId: created.mrp.id,
        originCanvasId: parent.id,
        isExternalReference: true,
        selectedForContext: true
      })
    );
    expect(childSnapshot?.mrps).toContainEqual(
      expect.objectContaining({
        id: created.mrp.id,
        canvasId: parent.id
      })
    );

    const bundle = await repository.saveContextBundleFromSelection(child.canvas.id, "Branch starter");
    expect(bundle).toEqual(
      expect.objectContaining({
        canvasId: child.canvas.id,
        name: "Branch starter",
        selectedMrpIds: [created.mrp.id],
        modeByMrpId: { [created.mrp.id]: "full_mrp" }
      })
    );
    await repository.updatePlacement(child.canvas.id, created.mrp.id, { selectedForContext: false });
    const appliedPlacements = await repository.applyContextBundle(child.canvas.id, bundle.id);
    expect(appliedPlacements).toContainEqual(
      expect.objectContaining({
        mrpId: created.mrp.id,
        selectedForContext: true
      })
    );
    await repository.deleteContextBundle(child.canvas.id, bundle.id);
    const childAfterBundleDelete = await repository.getCanvasSnapshot(child.canvas.id);
    expect(childAfterBundleDelete?.contextBundles).toEqual([]);

    const target = await repository.createCanvas("Import Target");
    const imported = await repository.importExternalMrps(target.id, [created.mrp.id], {
      layoutWidth: 900,
      rowHeight: 300
    });
    expect(imported.placements).toContainEqual(
      expect.objectContaining({
        canvasId: target.id,
        mrpId: created.mrp.id,
        originCanvasId: parent.id,
        isExternalReference: true,
        selectedForContext: false
      })
    );

    const snapped = await repository.snapBack(child.canvas.id, 900, 300, 10, 20);
    expect(snapped).toContainEqual(
      expect.objectContaining({
        canvasId: child.canvas.id,
        mrpId: created.mrp.id,
        x: 66,
        y: 76
      })
    );
    const clearedPlacements = await repository.updateCanvasSelection(child.canvas.id, false);
    expect(clearedPlacements.every((placement) => !placement.selectedForContext)).toBe(true);
    const checkedPlacements = await repository.updateCanvasSelection(child.canvas.id, true);
    expect(checkedPlacements.every((placement) => placement.selectedForContext)).toBe(true);

    const renamed = await repository.updateCanvasTitle(target.id, "Ridgey Workflow");
    expect(renamed?.title).toBe("Ridgey Workflow");

    await repository.deleteCanvas(child.canvas.id);
    expect(await repository.getCanvasSnapshot(child.canvas.id)).toBeUndefined();
    const parentAfterChildDelete = await repository.getCanvasSnapshot(parent.id);
    expect(parentAfterChildDelete?.mrps).toContainEqual(expect.objectContaining({ id: created.mrp.id }));

    rmSync(dbPath, { force: true });
    rmSync(`${dbPath}-wal`, { force: true });
    rmSync(`${dbPath}-shm`, { force: true });
  });
});
