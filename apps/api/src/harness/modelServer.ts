import { spawn } from "node:child_process";
import type { PiTarget } from "./targets.js";

/**
 * Lifecycle for a remote model server (the ik_llama.cpp llama-server behind an
 * ssh Pi target). The server is what `run-server-ik.sh` launches and what pi
 * on the desktop talks to; pi itself is spawned per-prompt, so "starting Pi"
 * really means making sure this server is up.
 */

export interface ModelServerStatus {
  /** false for non-ssh targets or targets without a health url. */
  managed: boolean;
  running: boolean;
  httpStatus?: number;
  error?: string;
}

export interface ModelServerStartResult {
  started: boolean;
  alreadyRunning: boolean;
  error?: string;
}

/** Probe the model server's /v1/models endpoint from the remote host. */
export async function checkModelServer(target: PiTarget): Promise<ModelServerStatus> {
  if (target.transport !== "ssh" || !target.sshHost || !target.serverHealthUrl) {
    return { managed: false, running: false };
  }
  // curl from the desktop itself — the server binds the host's Tailscale IP,
  // which the desktop can always reach.
  const cmd = `curl -s -o /dev/null -w '%{http_code}' -m 5 ${target.serverHealthUrl}`;
  const res = await runSsh(target.sshHost, cmd, 12_000);
  if (res.error) return { managed: true, running: false, error: res.error };
  const httpStatus = Number(res.stdout.trim()) || 0;
  return { managed: true, running: httpStatus >= 200 && httpStatus < 500, httpStatus };
}

/** Launch the model server detached so it outlives the ssh session. No-op if
 *  it's already healthy. */
export async function startModelServer(target: PiTarget): Promise<ModelServerStartResult> {
  if (target.transport !== "ssh" || !target.sshHost || !target.serverStartCmd) {
    return { started: false, alreadyRunning: false, error: "target has no managed model server" };
  }

  const status = await checkModelServer(target);
  if (status.running) return { started: false, alreadyRunning: true };

  // setsid + nohup + detached stdio so the server survives the ssh disconnect.
  // ~ and the start cmd are expanded by the remote login shell (sh -lc).
  const log = "~/flowux-modelserver.log";
  const inner = `setsid nohup ${target.serverStartCmd} > ${log} 2>&1 < /dev/null & disown; echo launched`;
  const res = await runSsh(target.sshHost, `sh -lc ${shellQuote(inner)}`, 15_000);
  if (res.error) return { started: false, alreadyRunning: false, error: res.error };
  if (!/launched/.test(res.stdout)) {
    return { started: false, alreadyRunning: false, error: res.stderr.trim() || "failed to launch" };
  }
  return { started: true, alreadyRunning: false };
}

interface SshRun {
  code: number | null;
  stdout: string;
  stderr: string;
  error?: string;
}

function runSsh(host: string, command: string, timeoutMs: number): Promise<SshRun> {
  return new Promise((resolve) => {
    const child = spawn(
      "ssh",
      ["-T", "-o", "BatchMode=yes", "-o", "ConnectTimeout=8", host, command],
      { stdio: ["ignore", "pipe", "pipe"] }
    );
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (run: SshRun) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(run);
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish({ code: null, stdout, stderr, error: "ssh timed out" });
    }, timeoutMs);
    child.stdout.on("data", (c) => (stdout += c.toString()));
    child.stderr.on("data", (c) => (stderr += c.toString()));
    child.on("error", (e) => finish({ code: null, stdout, stderr, error: e.message }));
    child.on("close", (code) => finish({ code, stdout, stderr }));
  });
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
