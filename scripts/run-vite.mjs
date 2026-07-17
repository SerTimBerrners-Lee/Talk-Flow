import { spawn } from "node:child_process";
import { existsSync, mkdirSync, copyFileSync, chmodSync } from "node:fs";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const DEV_SERVER_PORT = 14320;

function normalizeWindowsPath(path) {
  if (process.platform !== "win32") return path;

  return path.replace(/^\/([A-Za-z]:[\\/])/, "$1");
}

const rootDir = dirname(dirname(normalizeWindowsPath(fileURLToPath(import.meta.url))));

function resolvePackageFile(packageName, relativePath) {
  return join(dirname(require.resolve(`${packageName}/package.json`)), relativePath);
}

function prepareEsbuildBinary() {
  if (process.platform !== "darwin") return undefined;

  const source = resolvePackageFile("esbuild", "bin/esbuild");
  if (!existsSync(source)) return undefined;

  const targetDir = join(tmpdir(), "talkis-esbuild");
  const target = join(targetDir, `esbuild-${process.platform}-${process.arch}`);

  mkdirSync(targetDir, { recursive: true });
  copyFileSync(source, target);
  chmodSync(target, 0o755);

  return target;
}

function resolveViteScript() {
  return normalizeWindowsPath(resolvePackageFile("vite", "bin/vite.js"));
}

function isDevServerCommand(args) {
  const command = args.find((arg) => !arg.startsWith("-"));
  return command === undefined || command === "dev" || command === "serve";
}

function canBind(host, port) {
  return new Promise((resolve, reject) => {
    const server = createServer();

    server.once("error", (error) => {
      if (error?.code === "EADDRINUSE") {
        resolve(false);
        return;
      }

      reject(error);
    });

    server.listen(port, host, () => {
      server.close(() => resolve(true));
    });
  });
}

async function assertDevServerPortAvailable() {
  const [ipv4Available, ipv6Available] = await Promise.all([
    canBind("127.0.0.1", DEV_SERVER_PORT),
    canBind("::1", DEV_SERVER_PORT).catch(() => true),
  ]);

  if (ipv4Available && ipv6Available) return;

  throw new Error(
    `Talkis dev server port ${DEV_SERVER_PORT} is already in use. ` +
      "Stop the other local dev server before running `bun run tauri dev`.",
  );
}

const env = { ...process.env };
const esbuildBinary = prepareEsbuildBinary();
const viteArgs = process.argv.slice(2);

if (viteArgs.includes("--talkis-check-dev-port")) {
  try {
    await assertDevServerPortAvailable();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }

  process.exit(0);
}

if (esbuildBinary) {
  env.ESBUILD_BINARY_PATH = esbuildBinary;
}

try {
  if (isDevServerCommand(viteArgs)) {
    await assertDevServerPortAvailable();
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

const nodeBinary = process.env.TALKIS_NODE_BINARY || "node";
const child = spawn(nodeBinary, [resolveViteScript(), ...viteArgs], {
  cwd: rootDir,
  env,
  stdio: "inherit",
});

child.on("error", (error) => {
  console.error(`Failed to start Vite with ${nodeBinary}: ${error.message}`);
  process.exit(1);
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 1);
});
