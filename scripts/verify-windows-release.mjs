import { execFileSync } from "node:child_process";
import {
  closeSync,
  existsSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const tauriDir = join(rootDir, "src-tauri");
const expectedTargetTriple =
  process.env.TALKIS_WINDOWS_TARGET_TRIPLE || "x86_64-pc-windows-msvc";
const IMAGE_FILE_MACHINE_I386 = 0x014c;
const IMAGE_FILE_MACHINE_AMD64 = 0x8664;
const REQUIRED_INSTALLER_PROCESS_NAMES = [
  "Talkis.exe",
  "talkis-stt.exe",
  "talkis-diarize.exe",
  "talkis-llm.exe",
  "talkis-ffmpeg.exe",
];

function verifyInstallerHooks() {
  const configPath = join(tauriDir, "tauri.conf.json");
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  const relativeHookPath = config.bundle?.windows?.nsis?.installerHooks;
  if (typeof relativeHookPath !== "string" || relativeHookPath.length === 0) {
    throw new Error("Windows NSIS installerHooks is not configured");
  }

  const hookPath = join(tauriDir, relativeHookPath);
  if (!existsSync(hookPath)) {
    throw new Error(`Windows NSIS installer hook is missing: ${hookPath}`);
  }

  const source = readFileSync(hookPath, "utf8");
  for (const macro of ["NSIS_HOOK_PREINSTALL", "NSIS_HOOK_PREUNINSTALL"]) {
    if (!source.includes(`!macro ${macro}`)) {
      throw new Error(`Windows NSIS installer hook is missing ${macro}`);
    }
  }
  for (const imageName of REQUIRED_INSTALLER_PROCESS_NAMES) {
    if (!source.includes(`\"${imageName}\"`)) {
      throw new Error(
        `Windows NSIS installer hook does not stop ${imageName}`,
      );
    }
  }

  console.log(`Verified Windows NSIS process cleanup hook: ${hookPath}`);
}

function parsePeMachine(header, label) {
  if (header.length < 64 || header.toString("ascii", 0, 2) !== "MZ") {
    throw new Error(
      `${label} is not a Windows PE executable (missing MZ header)`,
    );
  }

  const peOffset = header.readUInt32LE(0x3c);
  if (peOffset + 6 > header.length) {
    throw new Error(`${label} PE header is outside the inspected bytes`);
  }
  if (header.toString("ascii", peOffset, peOffset + 4) !== "PE\u0000\u0000") {
    throw new Error(
      `${label} is not a Windows PE executable (missing PE signature)`,
    );
  }

  return header.readUInt16LE(peOffset + 4);
}

function readPeMachine(path) {
  const fd = openSync(path, "r");
  try {
    const dosHeader = Buffer.alloc(64);
    const dosBytes = readSync(fd, dosHeader, 0, dosHeader.length, 0);
    if (dosBytes < dosHeader.length) {
      throw new Error(`${path} is too small to contain a PE header`);
    }

    const peOffset = dosHeader.readUInt32LE(0x3c);
    const header = Buffer.alloc(peOffset + 6);
    const bytes = readSync(fd, header, 0, header.length, 0);
    if (bytes < header.length) {
      throw new Error(`${path} is truncated before its PE header`);
    }

    return parsePeMachine(header, path);
  } finally {
    closeSync(fd);
  }
}

function machineLabel(machine) {
  if (machine === IMAGE_FILE_MACHINE_AMD64) return "x86-64";
  if (machine === IMAGE_FILE_MACHINE_I386) return "x86";
  return `unknown (0x${machine.toString(16).padStart(4, "0")})`;
}

function requireMachine(path, expectedMachine) {
  if (!existsSync(path)) {
    throw new Error(`Required Windows release executable is missing: ${path}`);
  }

  const machine = readPeMachine(path);
  if (machine !== expectedMachine) {
    throw new Error(
      `${path} has ${machineLabel(machine)} architecture; expected ${machineLabel(expectedMachine)}`,
    );
  }
  console.log(`Verified ${machineLabel(machine)} PE: ${path}`);
}

function runSelfTest() {
  const fixture = Buffer.alloc(256);
  fixture.write("MZ", 0, "ascii");
  fixture.writeUInt32LE(0x80, 0x3c);
  fixture.write("PE\u0000\u0000", 0x80, "ascii");
  fixture.writeUInt16LE(IMAGE_FILE_MACHINE_AMD64, 0x84);

  const machine = parsePeMachine(fixture, "synthetic PE");
  if (machine !== IMAGE_FILE_MACHINE_AMD64) {
    throw new Error("PE parser self-test returned an unexpected architecture");
  }
  console.log("Windows PE verifier self-test passed");
}

if (process.argv.includes("--self-test")) {
  runSelfTest();
  verifyInstallerHooks();
  process.exit(0);
}

if (process.platform !== "win32") {
  throw new Error(
    "Windows release verification must run on a native Windows runner",
  );
}

const rustVersion = execFileSync("rustc", ["-vV"], { encoding: "utf8" });
const rustHost = rustVersion
  .split("\n")
  .find((line) => line.startsWith("host:"))
  ?.slice("host:".length)
  .trim();
if (rustHost !== expectedTargetTriple) {
  throw new Error(
    `Windows release host is ${rustHost || "(unknown)"}; expected ${expectedTargetTriple}`,
  );
}

verifyInstallerHooks();

const releaseDir = join(tauriDir, "target", "release");
const binariesDir = join(tauriDir, "binaries");
const mainExecutableCandidates = [
  join(releaseDir, "Talkis.exe"),
  join(releaseDir, "talkis.exe"),
];
const mainExecutable = mainExecutableCandidates.find(existsSync);
if (!mainExecutable) {
  throw new Error(
    `Talkis Windows executable is missing: ${mainExecutableCandidates.join(" or ")}`,
  );
}

requireMachine(mainExecutable, IMAGE_FILE_MACHINE_AMD64);
for (const sidecar of [
  "talkis-ffmpeg",
  "talkis-stt",
  "talkis-diarize",
  "talkis-llm",
]) {
  requireMachine(
    join(binariesDir, `${sidecar}-${expectedTargetTriple}.exe`),
    IMAGE_FILE_MACHINE_AMD64,
  );
}

const nsisDir = join(releaseDir, "bundle", "nsis");
const installers = existsSync(nsisDir)
  ? readdirSync(nsisDir)
      .filter((name) => name.toLowerCase().endsWith(".exe"))
      .map((name) => join(nsisDir, name))
  : [];
if (installers.length === 0) {
  throw new Error(`Windows NSIS installer is missing from ${nsisDir}`);
}

for (const installer of installers) {
  const machine = readPeMachine(installer);
  if (
    machine !== IMAGE_FILE_MACHINE_I386 &&
    machine !== IMAGE_FILE_MACHINE_AMD64
  ) {
    throw new Error(
      `${installer} uses unsupported installer architecture ${machineLabel(machine)}`,
    );
  }
  console.log(
    `Verified Windows-compatible NSIS stub (${machineLabel(machine)}): ${installer}`,
  );
}

console.log(
  `Windows release architecture verification passed for ${expectedTargetTriple}`,
);
