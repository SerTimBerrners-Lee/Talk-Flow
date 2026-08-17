import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { win32 as windowsPath } from "node:path";

function environmentValue(env, name) {
  const key = Object.keys(env).find(
    (candidate) => candidate.toLowerCase() === name.toLowerCase(),
  );
  return key ? env[key] : undefined;
}

function environmentKey(env, name) {
  return (
    Object.keys(env).find(
      (candidate) => candidate.toLowerCase() === name.toLowerCase(),
    ) || name
  );
}

function normalizedDirectory(directory) {
  return directory.replace(/[\\/]+$/, "").toLowerCase();
}

function visualStudioCmakeBin(installation) {
  return windowsPath.join(
    installation,
    "Common7",
    "IDE",
    "CommonExtensions",
    "Microsoft",
    "CMake",
    "CMake",
    "bin",
  );
}

function findVisualStudioInstallation(env, fileExists) {
  const candidates = [];
  const configuredInstallation = environmentValue(env, "VSINSTALLDIR");
  if (configuredInstallation) candidates.push(configuredInstallation);

  const programFilesX86 =
    environmentValue(env, "ProgramFiles(x86)") ||
    "C:\\Program Files (x86)";
  const vswhere = windowsPath.join(
    programFilesX86,
    "Microsoft Visual Studio",
    "Installer",
    "vswhere.exe",
  );

  if (fileExists(vswhere)) {
    try {
      const installation = execFileSync(
        vswhere,
        ["-latest", "-products", "*", "-property", "installationPath"],
        { encoding: "utf8", env },
      ).trim();
      if (installation) candidates.push(installation);
    } catch {
      // Fall through to the standard Visual Studio installation paths.
    }
  }

  for (const edition of [
    "BuildTools",
    "Community",
    "Professional",
    "Enterprise",
  ]) {
    const installation = windowsPath.join(
      programFilesX86,
      "Microsoft Visual Studio",
      "2022",
      edition,
    );
    candidates.push(installation);
  }

  return candidates.find((installation) => {
    const cmake = windowsPath.join(
      visualStudioCmakeBin(installation),
      "cmake.exe",
    );
    return fileExists(cmake);
  });
}

export function withWindowsToolchainPaths(
  sourceEnv = process.env,
  options = {},
) {
  const platform = options.platform || process.platform;
  const fileExists = options.fileExists || existsSync;
  const env = { ...sourceEnv };
  if (platform !== "win32") return env;

  const userProfile = environmentValue(env, "USERPROFILE");
  const cargoHome =
    environmentValue(env, "CARGO_HOME") ||
    (userProfile ? windowsPath.join(userProfile, ".cargo") : undefined);
  const cargoBin = cargoHome
    ? windowsPath.join(cargoHome, "bin")
    : undefined;

  const visualStudioInstallation =
    options.visualStudioInstallation ||
    findVisualStudioInstallation(env, fileExists);
  const cmakeBin = visualStudioInstallation
    ? visualStudioCmakeBin(visualStudioInstallation)
    : undefined;

  const programFiles =
    environmentValue(env, "ProgramFiles") || "C:\\Program Files";
  const llvmBin = windowsPath.join(programFiles, "LLVM", "bin");
  const discoveredDirectories = [
    cargoBin && fileExists(windowsPath.join(cargoBin, "rustc.exe"))
      ? cargoBin
      : undefined,
    cmakeBin && fileExists(windowsPath.join(cmakeBin, "cmake.exe"))
      ? cmakeBin
      : undefined,
    fileExists(windowsPath.join(llvmBin, "libclang.dll"))
      ? llvmBin
      : undefined,
  ].filter(Boolean);

  const pathKey = environmentKey(env, "PATH");
  const currentDirectories = (env[pathKey] || "")
    .split(";")
    .filter(Boolean);
  const seenDirectories = new Set();
  env[pathKey] = [...discoveredDirectories, ...currentDirectories]
    .filter((directory) => {
      const normalized = normalizedDirectory(directory);
      if (seenDirectories.has(normalized)) return false;
      seenDirectories.add(normalized);
      return true;
    })
    .join(";");

  if (
    !environmentValue(env, "LIBCLANG_PATH") &&
    fileExists(windowsPath.join(llvmBin, "libclang.dll"))
  ) {
    env.LIBCLANG_PATH = llvmBin;
  }

  return env;
}
