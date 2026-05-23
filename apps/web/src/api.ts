import type {
  CanvasPlacement,
  CanvasSnapshot,
  CanvasThread,
  ContextBundle,
  CreateChildCanvasResponse,
  CreatePromptResponse,
  HealthStatus,
  ImportExternalMrpsResponse,
  MrpDetails,
  SearchResponse
} from "@flowux/shared";

export async function getHealth(): Promise<HealthStatus> {
  return fetchJson("/api/health");
}

export async function listCanvases(): Promise<CanvasThread[]> {
  return fetchJson("/api/canvases");
}

export async function createCanvas(title: string): Promise<CanvasThread> {
  return fetchJson("/api/canvases", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title })
  });
}

export async function updateCanvasTitle(canvasId: string, title: string): Promise<CanvasThread> {
  return fetchJson(`/api/canvases/${canvasId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title })
  });
}

export async function updateCanvasStatus(canvasId: string, status: "temporary" | "saved"): Promise<CanvasThread> {
  return fetchJson(`/api/canvases/${canvasId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ status })
  });
}

export async function deleteCanvas(canvasId: string): Promise<{ deletedCanvasId: string }> {
  return fetchJson(`/api/canvases/${canvasId}`, {
    method: "DELETE"
  });
}

export async function getCanvas(canvasId: string, options: { summary?: boolean } = {}): Promise<CanvasSnapshot> {
  return fetchJson(`/api/canvases/${canvasId}${options.summary ? "?summary=true" : ""}`);
}

export async function getMrpDetails(canvasId: string, mrpId: string): Promise<MrpDetails> {
  return fetchJson(`/api/canvases/${canvasId}/mrps/${mrpId}/details`);
}

export async function searchWorkspace(query: string): Promise<SearchResponse> {
  const params = new URLSearchParams({ q: query });
  return fetchJson(`/api/search?${params.toString()}`);
}

export async function createChildCanvas(canvasId: string): Promise<CreateChildCanvasResponse> {
  return fetchJson(`/api/canvases/${canvasId}/branches`, {
    method: "POST"
  });
}

export async function importExternalMrps(
  canvasId: string,
  mrpIds: string[],
  layout?: LayoutRequest
): Promise<ImportExternalMrpsResponse> {
  return fetchJson(`/api/canvases/${canvasId}/references`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ mrpIds, layout })
  });
}

export async function saveContextBundle(canvasId: string, name?: string): Promise<ContextBundle> {
  return fetchJson(`/api/canvases/${canvasId}/context-bundles`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name })
  });
}

export async function applyContextBundle(canvasId: string, bundleId: string): Promise<CanvasPlacement[]> {
  return fetchJson(`/api/canvases/${canvasId}/context-bundles/${bundleId}/apply`, {
    method: "POST"
  });
}

export async function deleteContextBundle(canvasId: string, bundleId: string): Promise<{ deletedBundleId: string }> {
  return fetchJson(`/api/canvases/${canvasId}/context-bundles/${bundleId}`, {
    method: "DELETE"
  });
}

export async function updatePlacement(
  canvasId: string,
  mrpId: string,
  patch: Partial<CanvasPlacement>
): Promise<CanvasPlacement> {
  return fetchJson(`/api/canvases/${canvasId}/placements/${mrpId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(patch)
  });
}

export async function updateCanvasSelection(canvasId: string, selectedForContext: boolean): Promise<CanvasPlacement[]> {
  return fetchJson(`/api/canvases/${canvasId}/placements`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ selectedForContext })
  });
}

export interface LayoutRequest {
  layoutWidth?: number;
  layoutLeft?: number;
  layoutTop?: number;
  rowHeight?: number;
}

export async function snapBack(canvasId: string, layout?: LayoutRequest): Promise<CanvasPlacement[]> {
  return fetchJson(`/api/canvases/${canvasId}/snap-back`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(layout ?? {})
  });
}

export async function cancelPrompt(canvasId: string): Promise<{ cancelled: boolean; mrpId?: string }> {
  return fetchJson(`/api/canvases/${canvasId}/prompts/cancel`, {
    method: "POST"
  });
}

export async function streamPrompt(
  canvasId: string,
  prompt: string,
  layout: LayoutRequest,
  handlers: {
    onCreated: (payload: CreatePromptResponse) => void;
    onToken: (payload: { mrpId: string; token: string }) => void;
    onComplete: (payload: { mrp: import("@flowux/shared").Mrp }) => void;
    onError: (message: string) => void;
  }
) {
  const response = await fetch(`/api/canvases/${canvasId}/prompts/stream`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt, ...layout })
  });

  if (!response.ok || !response.body) {
    handlers.onError(await response.text());
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split("\n\n");
    buffer = events.pop() ?? "";

    for (const event of events) {
      const eventName = event.match(/^event: (.+)$/m)?.[1];
      const data = event.match(/^data: (.+)$/m)?.[1];
      if (!eventName || !data) continue;
      const payload = JSON.parse(data) as unknown;
      if (eventName === "created") handlers.onCreated(payload as CreatePromptResponse);
      if (eventName === "token") handlers.onToken(payload as { mrpId: string; token: string });
      if (eventName === "complete") handlers.onComplete(payload as { mrp: import("@flowux/shared").Mrp });
      if (eventName === "error") handlers.onError((payload as { message?: string }).message ?? "Stream error");
    }
  }
}

async function fetchJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init);
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return response.json() as Promise<T>;
}
