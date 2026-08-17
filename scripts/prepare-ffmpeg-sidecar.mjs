import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { withWindowsToolchainPaths } from "./windows-toolchain-env.mjs";

const require = createRequire(import.meta.url);
const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const binariesDir = join(rootDir, "src-tauri", "binaries");
const toolchainEnv = withWindowsToolchainPaths(process.env);

function readTargetTriple() {
  if (toolchainEnv.TAURI_FFMPEG_TARGET_TRIPLE) {
    return toolchainEnv.TAURI_FFMPEG_TARGET_TRIPLE.trim();
  }

  try {
    return execFileSync("rustc", ["--print", "host-tuple"], {
      encoding: "utf8",
      env: toolchainEnv,
    }).trim();
  } catch {
    const versionOutput = execFileSync("rustc", ["-Vv"], {
      encoding: "utf8",
      env: toolchainEnv,
    });
    const hostLine = versionOutput.split("\n").find((line) => line.startsWith("host:"));

    if (!hostLine) {
      throw new Error("Failed to determine Rust target triple");
    }

    return hostLine.replace("host:", "").trim();
  }
}

function resolveSourceBinary() {
  if (process.env.FFMPEG_PATH && process.env.FFMPEG_PATH.trim()) {
    return process.env.FFMPEG_PATH.trim();
  }

  return require("ffmpeg-static");
}

function fileHash(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function copyFileIfChanged(source, destination) {
  if (existsSync(destination)) {
    const sourceStat = statSync(source);
    const destinationStat = statSync(destination);

    if (sourceStat.size === destinationStat.size && fileHash(source) === fileHash(destination)) {
      return false;
    }
  }

  copyFileSync(source, destination);
  return true;
}

const targetTriple = readTargetTriple();
const sourceBinary = resolveSourceBinary();
const extension = targetTriple.includes("windows") ? ".exe" : "";
const destinationBinary = join(binariesDir, `talkis-ffmpeg-${targetTriple}${extension}`);

if (!sourceBinary || !existsSync(sourceBinary)) {
  throw new Error(`ffmpeg binary was not found: ${sourceBinary || "(empty)"}`);
}

if (!statSync(sourceBinary).isFile()) {
  throw new Error(`ffmpeg path is not a file: ${sourceBinary}`);
}

mkdirSync(binariesDir, { recursive: true });
copyFileIfChanged(sourceBinary, destinationBinary);

if (!targetTriple.includes("windows")) {
  chmodSync(destinationBinary, 0o755);
}

console.log(`Prepared ffmpeg sidecar: ${destinationBinary}`);
