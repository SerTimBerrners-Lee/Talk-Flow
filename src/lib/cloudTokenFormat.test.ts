import { describe, expect, test } from "bun:test";

import {
  calculateCloudBalanceProgress,
  formatCloudMilliTokens,
  roundCloudMilliTokens,
} from "./cloudTokenFormat";

describe("cloud token display formatting", () => {
  test("rounds fractional tokens to the nearest whole token", () => {
    expect(roundCloudMilliTokens(3_884_001n)).toBe(3_884n);
    expect(roundCloudMilliTokens(13_600n)).toBe(14n);
    expect(roundCloudMilliTokens(500n)).toBe(1n);
    expect(roundCloudMilliTokens(499n)).toBe(0n);
  });

  test("formats whole tokens with the selected locale", () => {
    expect(formatCloudMilliTokens("3884001", "ru-RU")).toBe("3 884");
    expect(formatCloudMilliTokens(13_600n, "en-US")).toBe("14");
  });

  test("uses zero for an invalid API value", () => {
    expect(formatCloudMilliTokens("invalid", "ru-RU")).toBe("0");
  });

  test("includes reservations without rounding an incomplete balance to 100%", () => {
    expect(
      calculateCloudBalanceProgress(3_884_001n, 13_600n, 3_900_000n),
    ).toEqual({
      totalMilliTokens: 3_897_601n,
      percentage: 99.93,
      wholePercentage: 99,
    });
    expect(calculateCloudBalanceProgress(10n, 5n, 0n).wholePercentage).toBe(0);
  });
});
