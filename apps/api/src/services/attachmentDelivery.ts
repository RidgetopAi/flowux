import type { UploadedAttachment } from "@flowux/shared";
import fs from "node:fs/promises";
import path from "node:path";
import type { FlowuxConfig } from "../config.js";
import type { ModelCapabilities } from "../harness/capabilities.js";
import { readUploadBytes } from "./uploadService.js";

export interface HarnessImageInput {
  type: "image";
  data: string;
  mimeType: string;
}

export interface AttachmentDeliveryItem {
  attachment: UploadedAttachment;
  modelDelivery: "image_input" | "text_preview" | "remote_file" | "artifact_only";
  remotePath?: string;
}

export interface AttachmentDelivery {
  items: AttachmentDeliveryItem[];
  images: HarnessImageInput[];
  promptText: string;
}

export async function prepareAttachmentDelivery(
  config: FlowuxConfig,
  caps: ModelCapabilities,
  attachments: UploadedAttachment[],
  options: { stageRemote: boolean; includeImageData?: boolean }
): Promise<AttachmentDelivery> {
  if (!attachments.length) return { items: [], images: [], promptText: "" };

  // Capability is the single source of truth (resolved per active connector),
  // not a per-harness hardcode. inline_base64 → ride bytes in the request;
  // remote_file → stage on the model's machine and pass a path (P3 makes that
  // staging actually remote; today it stages locally for the pi workspace).
  const supportsImages = caps.supportsImages;
  const inlineImages = supportsImages && caps.imageDelivery === "inline_base64";
  const items: AttachmentDeliveryItem[] = [];
  const images: HarnessImageInput[] = [];

  for (const attachment of attachments) {
    const needsBytes =
      options.stageRemote || (options.includeImageData === true && attachment.type === "image" && inlineImages);
    const upload = needsBytes ? await readUploadBytes(attachment.id) : undefined;
    const remotePath =
      options.stageRemote && config.harnessMode === "pi_mono" && upload
        ? await stageUploadLocally(config, attachment, upload.buffer)
        : undefined;

    if (attachment.type === "image" && inlineImages && upload) {
      images.push({
        type: "image",
        data: upload.buffer.toString("base64"),
        mimeType: attachment.mimeType ?? inferImageMimeType(attachment.name)
      });
      items.push({ attachment, modelDelivery: "image_input", remotePath });
      continue;
    }

    if (attachment.textPreview) {
      items.push({ attachment, modelDelivery: "text_preview", remotePath });
      continue;
    }

    items.push({ attachment, modelDelivery: remotePath ? "remote_file" : "artifact_only", remotePath });
  }

  return {
    items,
    images,
    promptText: formatDeliveryPrompt(items)
  };
}

async function stageUploadLocally(config: FlowuxConfig, attachment: UploadedAttachment, buffer: Buffer) {
  await fs.mkdir(config.piMonoUploadDir, { recursive: true });
  const stagedPath = path.join(config.piMonoUploadDir, `${attachment.id}-${sanitizeStagedFileName(attachment.name)}`);
  await fs.writeFile(stagedPath, buffer);
  return stagedPath;
}

function formatDeliveryPrompt(items: AttachmentDeliveryItem[]) {
  if (!items.length) return "";
  return [
    "User attached files for this turn:",
    ...items.map((item, index) => {
      const attachment = item.attachment;
      return [
        `Attachment ${index + 1}: ${attachment.name}`,
        `- Type: ${attachment.type}`,
        attachment.mimeType ? `- MIME: ${attachment.mimeType}` : undefined,
        `- Size: ${attachment.size} bytes`,
        `- Flowux URI: ${attachment.uri}`,
        item.remotePath ? `- Pi remote path: ${item.remotePath}` : undefined,
        `- Delivery: ${formatDeliveryLabel(item.modelDelivery)}`,
        attachment.textPreview ? `- Text preview:\n${attachment.textPreview}` : undefined
      ]
        .filter(Boolean)
        .join("\n");
    })
  ].join("\n\n");
}

function formatDeliveryLabel(delivery: AttachmentDeliveryItem["modelDelivery"]) {
  if (delivery === "image_input") return "sent to the model as image input; also staged as a local file when path is present";
  if (delivery === "text_preview") return "text/code preview included in this prompt";
  if (delivery === "remote_file") return "staged on the local Pi workspace; use tools to inspect the path if needed";
  return "stored as a Flowux artifact only; model-readable bytes were not available for this adapter";
}

function sanitizeStagedFileName(value: string) {
  return path.basename(value).replace(/[^\w .@()+\-[\]]/g, "_").slice(0, 160).trim() || "upload";
}

function inferImageMimeType(name: string) {
  if (/\.jpe?g$/i.test(name)) return "image/jpeg";
  if (/\.webp$/i.test(name)) return "image/webp";
  if (/\.gif$/i.test(name)) return "image/gif";
  return "image/png";
}
