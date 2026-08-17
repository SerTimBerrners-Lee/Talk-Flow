import { describe, expect, test } from "bun:test";

import { withWindowsToolchainPaths } from "./windows-toolchain-env.mjs";

describe("Windows toolchain environment", () => {
  test("discovers Rust, Visual Studio CMake, and LLVM outside a stale PATH", () => {
    const existingPaths = new Set([
      "C:\\Users\\Tester\\.cargo\\bin\\rustc.exe",
      "C:\\Visual Studio\\Common7\\IDE\\CommonExtensions\\Microsoft\\CMake\\CMake\\bin\\cmake.exe",
      "C:\\Program Files\\LLVM\\bin\\libclang.dll",
    ]);
    const env = withWindowsToolchainPaths(
      {
        Path: "C:\\Windows\\System32",
        USERPROFILE: "C:\\Users\\Tester",
        ProgramFiles: "C:\\Program Files",
      },
      {
        platform: "win32",
        fileExists: (path) => existingPaths.has(path),
        visualStudioInstallation: "C:\\Visual Studio",
      },
    );

    expect(env.Path.split(";")).toEqual([
      "C:\\Users\\Tester\\.cargo\\bin",
      "C:\\Visual Studio\\Common7\\IDE\\CommonExtensions\\Microsoft\\CMake\\CMake\\bin",
      "C:\\Program Files\\LLVM\\bin",
      "C:\\Windows\\System32",
    ]);
    expect(env.LIBCLANG_PATH).toBe("C:\\Program Files\\LLVM\\bin");
  });

  test("does not duplicate directories already present in PATH", () => {
    const rustBin = "C:\\Users\\Tester\\.cargo\\bin";
    const env = withWindowsToolchainPaths(
      {
        PATH: `${rustBin};C:\\Windows`,
        USERPROFILE: "C:\\Users\\Tester",
      },
      {
        platform: "win32",
        fileExists: (path) => path === `${rustBin}\\rustc.exe`,
      },
    );

    expect(env.PATH.split(";").filter((path) => path === rustBin)).toHaveLength(
      1,
    );
  });

  test("leaves non-Windows environments unchanged", () => {
    const sourceEnv = { PATH: "/usr/bin", HOME: "/tmp/user" };
    expect(
      withWindowsToolchainPaths(sourceEnv, { platform: "linux" }),
    ).toEqual(sourceEnv);
  });
});
