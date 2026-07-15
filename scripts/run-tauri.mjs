import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const tauriScript = join(
  rootDir,
  "node_modules",
  "@tauri-apps",
  "cli",
  "tauri.js",
);
const args = process.argv.slice(2);
const isDev = args[0] === "dev";
const isMacDev = process.platform === "darwin" && args[0] === "dev";
const hasCustomRunner = args.includes("--runner") || args.includes("-r");

if (isMacDev && !hasCustomRunner) {
  args.splice(
    1,
    0,
    "--runner",
    join(rootDir, "scripts", "run-macos-dev-app.sh"),
  );
}

function run(command, commandArgs) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, {
      cwd: rootDir,
      env: process.env,
      stdio: "inherit",
    });

    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (signal) {
        reject(new Error(`${command} terminated by signal ${signal}`));
        return;
      }

      if (code !== 0) {
        reject(new Error(`${command} exited with code ${code ?? 1}`));
        return;
      }

      resolve();
    });
  });
}

if (isDev) {
  try {
    await run("bun", ["scripts/run-vite.mjs", "--talkis-check-dev-port"]);
    await run("bun", ["run", "prepare:sidecars"]);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

const child = spawn(process.execPath, [tauriScript, ...args], {
  cwd: rootDir,
  env: process.env,
  stdio: "inherit",
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 1);
});
