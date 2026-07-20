import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const staticMsvcRuntimeArg = "-DCMAKE_MSVC_RUNTIME_LIBRARY=MultiThreaded";

function appendUniqueArgument(value, argument) {
  const current = value?.trim() || "";
  if (current.includes(argument)) return current;
  return [current, argument].filter(Boolean).join(" ");
}

function detectPlatform() {
  if (process.platform === "darwin") return "macos";
  if (process.platform === "win32") return "windows";
  if (process.platform === "linux") return "linux";
  throw new Error(`Unsupported release platform: ${process.platform}`);
}

const platform =
  process.argv[2] || process.env.TALKIS_RELEASE_PLATFORM || detectPlatform();
const bundleTargets = {
  macos: ["app"],
  windows: ["nsis"],
  linux: ["appimage", "deb"],
};
const releaseOutputs = {
  macos: ["app", "dmg"],
  windows: bundleTargets.windows,
  linux: bundleTargets.linux,
};

if (!Object.hasOwn(bundleTargets, platform)) {
  throw new Error(`Unsupported release platform: ${platform}`);
}

const env = {
  ...process.env,
  TALKIS_STT_RELEASE: process.env.TALKIS_STT_RELEASE || "1",
  TALKIS_SKIP_BEFORE_BUILD: "1",
};

if (platform === "windows" && !(env.RUSTFLAGS || "").includes("+crt-static")) {
  env.RUSTFLAGS = [env.RUSTFLAGS, "-C target-feature=+crt-static"]
    .filter(Boolean)
    .join(" ");
}

if (platform === "windows") {
  env.TRANSCRIBE_CMAKE_ARGS = appendUniqueArgument(
    env.TRANSCRIBE_CMAKE_ARGS,
    staticMsvcRuntimeArg,
  );
  env.LLAMA_STATIC_CRT = "1";
}

if (platform === "macos") {
  env.MACOSX_DEPLOYMENT_TARGET = process.env.MACOSX_DEPLOYMENT_TARGET || "11.0";

  if (!env.TAURI_SIGNING_PRIVATE_KEY && env.TAURI_SIGNING_PRIVATE_KEY_PATH) {
    if (!existsSync(env.TAURI_SIGNING_PRIVATE_KEY_PATH)) {
      throw new Error(
        `TAURI_SIGNING_PRIVATE_KEY_PATH does not point to a file: ${env.TAURI_SIGNING_PRIVATE_KEY_PATH}`,
      );
    }

    env.TAURI_SIGNING_PRIVATE_KEY = readFileSync(
      env.TAURI_SIGNING_PRIVATE_KEY_PATH,
      "utf8",
    );
  }

  if (env.TAURI_SIGNING_PRIVATE_KEY) {
    delete env.TAURI_SIGNING_PRIVATE_KEY_PATH;
  }
}

function run(command, args) {
  execFileSync(command, args, {
    cwd: rootDir,
    env,
    stdio: "inherit",
  });
}

run("bun", ["run", "prepare:sidecars"]);
run("bun", ["run", "build"]);
run("bun", [
  "run",
  "tauri",
  "build",
  "--bundles",
  bundleTargets[platform].join(","),
]);

if (platform === "windows") {
  run("bun", ["run", "verify:windows-release"]);
}

if (
  platform === "macos" &&
  process.env.TALKIS_POSTPROCESS_MACOS_RELEASE !== "0"
) {
  run("bun", ["run", "postprocess:macos-release"]);
}

console.log(
  `Built ${platform} release bundles: ${releaseOutputs[platform].join(", ")}`,
);
