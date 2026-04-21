import { spawn } from "node:child_process";
import { platform } from "node:os";

const PORT = Number(process.env.PORT ?? 3029);
const URL = `http://localhost:${PORT}`;

const child = spawn("next", ["dev", "-p", String(PORT)], {
  stdio: "inherit",
  shell: true,
});

child.on("exit", (code) => process.exit(code ?? 0));

const cleanup = (sig) => () => child.kill(sig);
process.on("SIGINT", cleanup("SIGINT"));
process.on("SIGTERM", cleanup("SIGTERM"));

const openUrl = (url) => {
  const p = platform();
  const cmd = p === "darwin" ? "open" : p === "win32" ? "start" : "xdg-open";
  spawn(cmd, [url], { stdio: "ignore", detached: true, shell: p === "win32" }).unref();
};

(async () => {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(URL, { signal: AbortSignal.timeout(500) });
      if (res.status < 500) {
        openUrl(URL);
        return;
      }
    } catch {
      // server not ready yet
    }
    await new Promise((r) => setTimeout(r, 400));
  }
})();
