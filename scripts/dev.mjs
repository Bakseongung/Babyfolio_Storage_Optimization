import net from "node:net";
import { once } from "node:events";
import { spawn, spawnSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

const backendPort = Number(process.env.BACKEND_PORT ?? 4000);
const frontendPort = Number(process.env.FRONTEND_PORT ?? 3000);
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
let backend;
let frontend;
let stopping = false;

function isPortOpen(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    let settled = false;
    const finish = (open) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(250);
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
    socket.once("timeout", () => finish(false));
  });
}

function start(project) {
  const isBackend = project === "backend";
  const env = {
    ...process.env,
    PORT: String(isBackend ? backendPort : frontendPort)
  };
  if (isBackend) env.APP_ORIGIN ??= `http://localhost:${frontendPort}`;
  else env.API_ORIGIN ??= `http://localhost:${backendPort}`;

  return spawn(pnpm, ["--filter", `./${project}`, "dev"], {
    cwd: new URL("..", import.meta.url),
    env,
    detached: process.platform !== "win32",
    shell: process.platform === "win32",
    stdio: "inherit"
  });
}

async function stop(child) {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true
    });
    return;
  }

  const exited = once(child, "exit").catch(() => undefined);
  const killGroup = (signal) => {
    try {
      process.kill(-child.pid, signal);
    } catch {
      child.kill(signal);
    }
  };
  killGroup("SIGTERM");
  await Promise.race([exited, delay(3_000)]);
  if (child.exitCode === null && child.signalCode === null) {
    killGroup("SIGKILL");
    await Promise.race([exited, delay(1_000)]);
  }
}

async function shutdown(code) {
  if (stopping) return;
  stopping = true;
  await Promise.all([stop(frontend), stop(backend)]);
  process.exit(code);
}

async function isBackendReady() {
  try {
    const response = await fetch(`http://127.0.0.1:${backendPort}/api/health/ready`, {
      signal: AbortSignal.timeout(1_000)
    });
    await response.body?.cancel();
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForBackend() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (backend.exitCode !== null) {
      throw new Error(`백엔드가 준비되기 전에 종료됐습니다. (exit ${backend.exitCode})`);
    }
    if (await isBackendReady()) return;
    await delay(200);
  }
  throw new Error(`백엔드 readiness 확인을 30초 동안 기다렸지만 응답이 없습니다. (:${backendPort})`);
}

async function main() {
  for (const [name, port] of [["BACKEND_PORT", backendPort], ["FRONTEND_PORT", frontendPort]]) {
    if (!Number.isInteger(port) || port < 1 || port > 65_535) {
      throw new Error(`올바르지 않은 ${name} 값입니다: ${process.env[name]}`);
    }
  }
  if (backendPort === frontendPort) {
    throw new Error("BACKEND_PORT와 FRONTEND_PORT는 서로 달라야 합니다.");
  }
  const [backendPortInUse, frontendPortInUse] = await Promise.all([
    isPortOpen(backendPort),
    isPortOpen(frontendPort)
  ]);
  if (backendPortInUse) {
    throw new Error(`${backendPort}번 백엔드 포트가 이미 사용 중입니다.`);
  }
  if (frontendPortInUse) {
    throw new Error(`${frontendPort}번 프론트엔드 포트가 이미 사용 중입니다.`);
  }

  backend = start("backend");
  await once(backend, "spawn");
  await waitForBackend();
  backend.once("exit", (code) => void shutdown(code ?? 1));
  if (backend.exitCode !== null) await shutdown(backend.exitCode ?? 1);
  console.log(`\n백엔드 준비 완료 (:${backendPort}). 프론트엔드를 시작합니다. (:${frontendPort})\n`);

  frontend = start("frontend");
  frontend.once("exit", (code, signal) => void shutdown(code ?? (signal ? 1 : 0)));
  await once(frontend, "spawn");
}

process.once("SIGINT", () => void shutdown(130));
process.once("SIGTERM", () => void shutdown(143));
main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  void shutdown(1);
});
