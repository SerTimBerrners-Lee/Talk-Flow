import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));

function readJson(relativePath) {
  return JSON.parse(readFileSync(join(rootDir, relativePath), "utf8"));
}

const packageVersion = readJson("package.json").version;
const tauriVersion = readJson("src-tauri/tauri.conf.json").version;
const cargoToml = readFileSync(join(rootDir, "src-tauri/Cargo.toml"), "utf8");
const cargoVersions = [...cargoToml.matchAll(/^version = "([^"]+)"$/gm)].map(
  (match) => match[1],
);

if (cargoVersions.length !== 2) {
  throw new Error(
    `Expected package and workspace versions in Cargo.toml, found ${cargoVersions.length}`,
  );
}

console.log(`package.json:       ${packageVersion}`);
console.log(`Cargo.toml:         ${cargoVersions.join(" / ")}`);
console.log(`tauri.conf.json:    ${tauriVersion}`);

const versions = [packageVersion, tauriVersion, ...cargoVersions];
if (versions.some((version) => version !== packageVersion)) {
  throw new Error("Version mismatch detected");
}

console.log(`\nAll versions match: ${packageVersion}`);
