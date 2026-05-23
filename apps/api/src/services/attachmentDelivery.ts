import type { UploadedAttachment } from "@flowux/shared";
import { spawn } from "node:child_process";
import path from "node:path";
import type { FlowuxConfig } from "../config.js";
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

export function supportsImageInputs(config: FlowuxConfig) {
  if (config.harnessMode !== "pi_mono") return false;
  if (config.piMonoProvider === "xai") return /^grok/i.test(config.piMonoModel);
  return false;
}

export async function prepareAttachmentDelivery(
  config: FlowuxConfig,
  attachments: UploadedAttachment[],
  options: { stageRemote: boolean; includeImageData?: boolean }
): Promise<AttachmentDelivery> {
  if (!attachments.length) return { items: [], images: [], promptText: "" };

  const supportsImages = supportsImageInputs(config);
  const items: AttachmentDeliveryItem[] = [];
  const images: HarnessImageInput[] = [];

  for (const attachment of attachments) {
    const needsBytes = options.stageRemote || (options.includeImageData === true && attachment.type === "image" && supportsImages);
    const upload = needsBytes ? await readUploadBytes(attachment.id) : undefined;
    const remotePath =
      options.stageRemote && config.harnessMode === "pi_mono" && upload
        ? await stageUploadOnPiHost(config, attachment, upload.buffer)
        : undefined;

    if (attachment.type === "image" && supportsImages && upload) {
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

async function stageUploadOnPiHost(config: FlowuxConfig, attachment: UploadedAttachment, buffer: Buffer) {
  const remotePath = path.posix.join(config.piMonoRemoteUploadDir, `${attachment.id}-${sanitizeRemoteFileName(attachment.name)}`);
  const remoteCommand = `mkdir -p ${shellQuote(config.piMonoRemoteUploadDir)} && cat > ${shellQuote(remotePath)}`;
  await runSshWithInput(config.piMonoRemoteHost, remoteCommand, buffer);
  return remotePath;
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
  if (delivery === "image_input") return "sent to the model as image input; also staged as a remote file when path is present";
  if (delivery === "text_preview") return "text/code preview included in this prompt";
  if (delivery === "remote_file") return "staged on the Pi tool host; use tools to inspect the remote path if needed";
  return "stored as a Flowux artifact only; model-readable bytes were not available for this adapter";
}

function runSshWithInput(host: string, command: string, input: Buffer) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn("ssh", [host, command], { stdio: ["pipe", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`Failed to stage attachment on Pi host: ${stderr.trim() || `ssh exited ${code}`}`));
    });
    child.stdin.end(input);
  });
}

function sanitizeRemoteFileName(value: string) {
  return path.basename(value).replace(/[^\w .@()+\-[\]]/g, "_").slice(0, 160).trim() || "upload";
}

function inferImageMimeType(name: string) {
  if (/\.jpe?g$/i.test(name)) return "image/jpeg";
  if (/\.webp$/i.test(name)) return "image/webp";
  if (/\.gif$/i.test(name)) return "image/gif";
  return "image/png";
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}
