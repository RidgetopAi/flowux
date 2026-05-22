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

    rmSync(dbPath, { force: true });
    rmSync(`${dbPath}-wal`, { force: true });
    rmSync(`${dbPath}-shm`, { force: true });
  });
});
