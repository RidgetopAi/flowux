import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { UploadedAttachment } from "@flowux/shared";

const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;
const TEXT_PREVIEW_BYTES = 64 * 1024;
const ROOT_DIR = path.resolve(process.cwd(), process.env.FLOWUX_UPLOAD_DIR ?? "apps/api/uploads");

export interface UploadInput {
  name: string;
  mimeType?: string;
  dataBase64: string;
}

export async function saveUpload(input: UploadInput): Promise<UploadedAttachment> {
  const safeName = sanitizeFileName(input.name);
  const buffer = Buffer.from(input.dataBase64, "base64");
  if (!safeName) throw new Error("upload_name_required");
  if (!buffer.length) throw new Error("upload_empty");
  if (buffer.length > MAX_UPLOAD_BYTES) throw new Error("upload_too_large");

  await mkdir(ROOT_DIR, { recursive: true });
  const id = crypto.randomUUID();
  const storedName = `${id}-${safeName}`;
  const filePath = path.join(ROOT_DIR, storedName);
  await writeFile(filePath, buffer);

  const attachment: UploadedAttachment = {
    id,
    type: getAttachmentType(safeName, input.mimeType),
    name: safeName,
    uri: `/api/uploads/${id}/${encodeURIComponent(safeName)}`,
    ...(input.mimeType ? { mimeType: input.mimeType } : {}),
    size: buffer.length,
    ...(getTextPreview(buffer, input.mimeType, safeName) ? { textPreview: getTextPreview(buffer, input.mimeType, safeName) } : {}),
    createdAt: new Date().toISOString()
  };

  await writeFile(path.join(ROOT_DIR, `${id}.json`), JSON.stringify({ ...attachment, storedName }, null, 2));
  return attachment;
}

export async function loadUpload(id: string): Promise<(UploadedAttachment & { storedName: string }) | undefined> {
  if (!isSafeId(id)) return undefined;
  try {
    return JSON.parse(await readFile(path.join(ROOT_DIR, `${id}.json`), "utf8")) as UploadedAttachment & { storedName: string };
  } catch {
    return undefined;
  }
}

export async function readUploadBytes(id: string) {
  const upload = await loadUpload(id);
  if (!upload) return undefined;
  return {
    upload,
    filePath: getUploadFilePath(upload.storedName),
    buffer: await readFile(getUploadFilePath(upload.storedName))
  };
}

export function getUploadFilePath(storedName: string) {
  return path.join(ROOT_DIR, storedName);
}

export function formatAttachmentsForPrompt(attachments: UploadedAttachment[]) {
  if (!attachments.length) return "";
  return [
    "User attached files for this turn:",
    ...attachments.map((attachment, index) =>
      [
        `Attachment ${index + 1}: ${attachment.name}`,
        `- Type: ${attachment.type}`,
        attachment.mimeType ? `- MIME: ${attachment.mimeType}` : undefined,
        `- Size: ${attachment.size} bytes`,
        `- Flowux URI: ${attachment.uri}`,
        attachment.textPreview ? `- Text preview:\n${attachment.textPreview}` : "- Binary/image content is available as a Flowux artifact reference."
      ]
        .filter(Boolean)
        .join("\n")
    )
  ].join("\n\n");
}

function sanitizeFileName(value: string) {
  return path.basename(value).replace(/[^\w .@()+\-[\]]/g, "_").slice(0, 160).trim();
}

function isSafeId(value: string) {
  return /^[a-f0-9-]{36}$/i.test(value);
}

function getAttachmentType(name: string, mimeType = ""): UploadedAttachment["type"] {
  if (mimeType.startsWith("image/")) return "image";
  if (/\.(ts|tsx|js|jsx|json|css|html|md|py|ps1|sh|sql|yaml|yml|toml)$/i.test(name)) return "code";
  return "file";
}

function getTextPreview(buffer: Buffer, mimeType = "", name = "") {
  const textLike =
    mimeType.startsWith("text/") ||
    /\b(json|xml|javascript|typescript|css|html|markdown|yaml|toml|csv)\b/i.test(mimeType) ||
    /\.(txt|md|json|csv|ts|tsx|js|jsx|css|html|py|ps1|sh|sql|yaml|yml|toml)$/i.test(name);
  if (!textLike) return undefined;
  return buffer.subarray(0, TEXT_PREVIEW_BYTES).toString("utf8");
}
