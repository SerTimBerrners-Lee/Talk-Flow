import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { withWindowsToolchainPaths } from "./windows-toolchain-env.mjs";

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const tauriDir = join(rootDir, "src-tauri");
const llmManifest = join(tauriDir, "sidecars", "talkis-llm", "Cargo.toml");
const binariesDir = join(tauriDir, "binaries");
const toolchainEnv = withWindowsToolchainPaths(process.env);
const placeholderContents = "#!/usr/bin/env sh\nexit 1\n";
const staticMsvcRuntimeArg = "-DCMAKE_MSVC_RUNTIME_LIBRARY=MultiThreaded";
const dynamicMsvcRuntimeArg = "-DCMAKE_MSVC_RUNTIME_LIBRARY=MultiThreadedDLL";
const commonLibraryDirectories = [
  "/lib",
  "/lib64",
  "/lib/aarch64-linux-gnu",
  "/lib/arm-linux-gnueabihf",
  "/lib/x86_64-linux-gnu",
  "/usr/lib",
  "/usr/lib64",
  "/usr/lib/aarch64-linux-gnu",
  "/usr/lib/arm-linux-gnueabihf",
  "/usr/lib/llvm-18/lib",
  "/usr/lib/llvm-17/lib",
  "/usr/lib/llvm-16/lib",
  "/usr/lib/llvm-15/lib",
  "/usr/lib/llvm-14/lib",
  "/usr/lib/x86_64-linux-gnu",
  "/usr/local/lib",
];

function directoryHasMatchingFile(directory, matches) {
  if (!directory || !existsSync(directory)) return false;

  try {
    return readdirSync(directory).some(matches);
  } catch {
    return false;
  }
}

function directoryHasLibclang(directory) {
  return directoryHasMatchingFile(
    directory,
    (name) =>
      name === "libclang.so" ||
      name.startsWith("libclang.so.") ||
      (name.startsWith("libclang-") && name.includes(".so")),
  );
}

function splitPathList(value) {
  if (!value) return [];
  return value.split(delimiter).filter(Boolean);
}

function librarySearchDirectories() {
  return [
    ...splitPathList(process.env.LIBRARY_PATH),
    ...splitPathList(process.env.LD_LIBRARY_PATH),
    ...commonLibraryDirectories,
  ];
}

function hasLibraryFile(fileName) {
  return librarySearchDirectories().some((directory) =>
    directoryHasMatchingFile(directory, (name) => name === fileName),
  );
}

function compilerCanFindLibraryFile(fileName) {
  for (const compiler of ["cc", "gcc"]) {
    const result = spawnSync(compiler, ["-print-file-name=" + fileName], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });

    if (result.error || result.status !== 0) continue;

    const resolvedPath = result.stdout.trim();
    if (resolvedPath && resolvedPath !== fileName && existsSync(resolvedPath)) {
      return true;
    }
  }

  return false;
}

function hasLinkableLibrary(libraryName) {
  const fileName = `lib${libraryName}.so`;
  return hasLibraryFile(fileName) || compilerCanFindLibraryFile(fileName);
}

function hasLibclang() {
  if (directoryHasLibclang(process.env.LIBCLANG_PATH)) {
    return true;
  }

  return librarySearchDirectories().some(directoryHasLibclang);
}

function commandExists(command) {
  const result = spawnSync(command, ["--version"], { stdio: "ignore" });
  return !result.error && result.status === 0;
}

function ensureLinuxBuildDependencies(targetTriple) {
  if (!targetTriple.includes("linux")) return;

  const missingPackages = [];

  if (!hasLibclang()) {
    missingPackages.push("clang", "libclang-dev");
  }

  if (!commandExists("cmake")) {
    missingPackages.push("cmake");
  }

  if (!hasLinkableLibrary("xdo")) {
    missingPackages.push("libxdo-dev");
  }

  if (missingPackages.length === 0) return;

  console.error("");
  console.error("Missing Linux build dependencies for local STT sidecars.");
  console.error(
    "transcribe-cpp needs cmake for native ggml/transcribe.cpp builds, and xdo is needed for Tauri/global hotkey linking.",
  );
  console.error("Install it on Ubuntu/Debian with:");
  console.error("");
  console.error(
    `  sudo apt update && sudo apt install -y ${missingPackages.join(" ")}`,
  );
  console.error("");
  console.error(
    "If libclang is installed in a custom location, set LIBCLANG_PATH to the directory that contains libclang.so.",
  );
  console.error("");
  process.exit(1);
}

function readTargetTriple() {
  if (toolchainEnv.TAURI_STT_TARGET_TRIPLE) {
    return toolchainEnv.TAURI_STT_TARGET_TRIPLE.trim();
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
    const hostLine = versionOutput
      .split("\n")
      .find((line) => line.startsWith("host:"));

    if (!hostLine) {
      throw new Error("Failed to determine Rust target triple");
    }

    return hostLine.replace("host:", "").trim();
  }
}

function markExecutable(path, targetTriple) {
  if (!targetTriple.includes("windows")) {
    chmodSync(path, 0o755);
  }
}

function fileHash(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function copyFileIfChanged(source, destination) {
  if (existsSync(destination)) {
    const sourceStat = statSync(source);
    const destinationStat = statSync(destination);

    if (
      sourceStat.size === destinationStat.size &&
      fileHash(source) === fileHash(destination)
    ) {
      return false;
    }
  }

  copyFileSync(source, destination);
  return true;
}

function appendUniqueArgument(value, argument) {
  const current = value?.trim() || "";
  if (current.split(/\s+/).includes(argument)) return current;
  return [current, argument].filter(Boolean).join(" ");
}

function replaceArgument(value, previous, next) {
  const current = (value || "")
    .split(/\s+/)
    .filter(
      (argument) => argument && argument !== previous && argument !== next,
    )
    .join(" ");
  return appendUniqueArgument(current, next);
}

function setMsvcRustCrtFeature(value, mode) {
  const withoutCrtFeature = (value || "")
    .replaceAll("-C target-feature=+crt-static", " ")
    .replaceAll("-Ctarget-feature=+crt-static", " ")
    .replaceAll("-C target-feature=-crt-static", " ")
    .replaceAll("-Ctarget-feature=-crt-static", " ")
    .trim();
  const feature =
    mode === "static"
      ? "-C target-feature=+crt-static"
      : "-C target-feature=-crt-static";
  return appendUniqueArgument(withoutCrtFeature, feature);
}

function cargoBuildEnvironment(
  targetTriple,
  runtimeMode,
  sourceEnv = process.env,
) {
  const env = { ...sourceEnv };
  if (!targetTriple.includes("windows-msvc")) return env;

  if (runtimeMode === "static") {
    env.RUSTFLAGS = setMsvcRustCrtFeature(env.RUSTFLAGS, "static");
    env.TRANSCRIBE_CMAKE_ARGS = appendUniqueArgument(
      env.TRANSCRIBE_CMAKE_ARGS,
      staticMsvcRuntimeArg,
    );
  } else if (runtimeMode === "dynamic") {
    env.RUSTFLAGS = setMsvcRustCrtFeature(env.RUSTFLAGS, "dynamic");
    env.TRANSCRIBE_CMAKE_ARGS = replaceArgument(
      env.TRANSCRIBE_CMAKE_ARGS,
      staticMsvcRuntimeArg,
      dynamicMsvcRuntimeArg,
    );
    env.LLAMA_STATIC_CRT = "0";
  }

  return env;
}

function removePlaceholder(path) {
  if (!existsSync(path)) return;

  try {
    const contents = readFileSync(path, "utf8");
    if (contents === placeholderContents) {
      unlinkSync(path);
    }
  } catch {
    // A real binary or an already removed placeholder must remain untouched.
  }
}

if (process.argv.includes("--self-test")) {
  const staticEnv = cargoBuildEnvironment("x86_64-pc-windows-msvc", "static", {
    RUSTFLAGS: "",
    TRANSCRIBE_CMAKE_ARGS: "-DTRANSCRIBE_X86_CONSERVATIVE=ON",
  });
  const dynamicEnv = cargoBuildEnvironment(
    "x86_64-pc-windows-msvc",
    "dynamic",
    {
      RUSTFLAGS: "-C target-feature=+crt-static",
      TRANSCRIBE_CMAKE_ARGS: staticMsvcRuntimeArg,
      LLAMA_STATIC_CRT: "1",
    },
  );

  if (!staticEnv.TRANSCRIBE_CMAKE_ARGS.includes(staticMsvcRuntimeArg)) {
    throw new Error(
      "Static MSVC self-test did not configure transcribe.cpp for /MT",
    );
  }
  if (!staticEnv.RUSTFLAGS.includes("+crt-static")) {
    throw new Error("Static MSVC self-test did not configure Rust for /MT");
  }
  if (dynamicEnv.RUSTFLAGS.includes("+crt-static")) {
    throw new Error("Dynamic MSVC self-test retained Rust's static CRT");
  }
  if (!dynamicEnv.RUSTFLAGS.includes("-crt-static")) {
    throw new Error("Dynamic MSVC self-test did not configure Rust for /MD");
  }
  if (!dynamicEnv.TRANSCRIBE_CMAKE_ARGS.includes(dynamicMsvcRuntimeArg)) {
    throw new Error(
      "Dynamic MSVC self-test did not configure native code for /MD",
    );
  }
  if (
    dynamicEnv.TRANSCRIBE_CMAKE_ARGS.split(/\s+/).includes(staticMsvcRuntimeArg)
  ) {
    throw new Error("Dynamic MSVC self-test retained native code's static CRT");
  }
  if (dynamicEnv.LLAMA_STATIC_CRT !== "0") {
    throw new Error(
      "Dynamic MSVC self-test did not configure llama.cpp for /MD",
    );
  }
  console.log("STT sidecar build-environment self-test passed");
  process.exit(0);
}

const targetTriple = readTargetTriple();
ensureLinuxBuildDependencies(targetTriple);
const sttCargoEnv = cargoBuildEnvironment(
  targetTriple,
  "static",
  toolchainEnv,
);
const llmCargoEnv = cargoBuildEnvironment(
  targetTriple,
  "dynamic",
  toolchainEnv,
);

const extension = targetTriple.includes("windows") ? ".exe" : "";
const profile = process.env.TALKIS_STT_RELEASE === "1" ? "release" : "debug";
const sidecars = ["talkis-stt", "talkis-diarize", "talkis-llm"];
const baseCargoArgs = [
  "build",
  "--manifest-path",
  join(tauriDir, "Cargo.toml"),
];
const sttCargoArgs = [
  ...baseCargoArgs,
  "--bin",
  "talkis-stt",
  "--bin",
  "talkis-diarize",
];
const llmCargoArgs = [
  "build",
  "--manifest-path",
  llmManifest,
  "--bin",
  "talkis-llm",
];

if (profile === "release") {
  sttCargoArgs.push("--release");
  llmCargoArgs.push("--release");
}

mkdirSync(binariesDir, { recursive: true });

for (const sidecar of sidecars) {
  const destinationBinary = join(
    binariesDir,
    `${sidecar}-${targetTriple}${extension}`,
  );
  if (!existsSync(destinationBinary)) {
    writeFileSync(destinationBinary, placeholderContents);
    markExecutable(destinationBinary, targetTriple);
  }
}

try {
  execFileSync("cargo", sttCargoArgs, {
    env: sttCargoEnv,
    stdio: "inherit",
  });
  execFileSync("cargo", llmCargoArgs, {
    env: llmCargoEnv,
    stdio: "inherit",
  });
} catch (error) {
  for (const sidecar of sidecars) {
    removePlaceholder(
      join(binariesDir, `${sidecar}-${targetTriple}${extension}`),
    );
  }
  throw error;
}

for (const sidecar of sidecars) {
  const sourceBinary = join(
    tauriDir,
    "target",
    profile,
    `${sidecar}${extension}`,
  );
  const destinationBinary = join(
    binariesDir,
    `${sidecar}-${targetTriple}${extension}`,
  );

  if (!existsSync(sourceBinary)) {
    throw new Error(`${sidecar} binary was not built: ${sourceBinary}`);
  }

  if (!statSync(sourceBinary).isFile()) {
    throw new Error(`${sidecar} path is not a file: ${sourceBinary}`);
  }

  markExecutable(sourceBinary, targetTriple);
  copyFileIfChanged(sourceBinary, destinationBinary);
  markExecutable(destinationBinary, targetTriple);

  console.log(`Prepared ${sidecar} sidecar: ${destinationBinary}`);
}
