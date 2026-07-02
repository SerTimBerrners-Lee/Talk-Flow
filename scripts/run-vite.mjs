import { spawn } from "node:child_process";
import { existsSync, mkdirSync, copyFileSync, chmodSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const rootDir = dirname(dirname(new URL(import.meta.url).pathname));

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

function resolveViteBin() {
  const binName = process.platform === "win32" ? "vite.cmd" : "vite";
  return join(rootDir, "node_modules", ".bin", binName);
}

const env = { ...process.env };
const esbuildBinary = prepareEsbuildBinary();

if (esbuildBinary) {
  env.ESBUILD_BINARY_PATH = esbuildBinary;
}

const child = spawn(resolveViteBin(), process.argv.slice(2), {
  cwd: rootDir,
  env,
  stdio: "inherit",
  shell: process.platform === "win32",
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 1);
});
