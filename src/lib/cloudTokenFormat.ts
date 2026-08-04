const MILLI_TOKENS_PER_TOKEN = 1_000n;
const ROUNDING_OFFSET = MILLI_TOKENS_PER_TOKEN / 2n;

export interface CloudBalanceProgress {
  totalMilliTokens: bigint;
  percentage: number;
  wholePercentage: number;
}

export function roundCloudMilliTokens(milliTokens: bigint): bigint {
  const offset = milliTokens < 0n ? -ROUNDING_OFFSET : ROUNDING_OFFSET;
  return (milliTokens + offset) / MILLI_TOKENS_PER_TOKEN;
}

export function formatCloudMilliTokens(
  value: bigint | string,
  locale: string,
): string {
  let milliTokens: bigint;
  try {
    milliTokens = typeof value === "bigint" ? value : BigInt(value);
  } catch {
    milliTokens = 0n;
  }

  return new Intl.NumberFormat(locale, {
    maximumFractionDigits: 0,
  }).format(roundCloudMilliTokens(milliTokens));
}

export function calculateCloudBalanceProgress(
  availableMilliTokens: bigint,
  reservedMilliTokens: bigint,
  targetMilliTokens: bigint,
): CloudBalanceProgress {
  const totalMilliTokens = availableMilliTokens + reservedMilliTokens;
  if (targetMilliTokens <= 0n || totalMilliTokens <= 0n) {
    return { totalMilliTokens, percentage: 0, wholePercentage: 0 };
  }

  const bounded =
    totalMilliTokens > targetMilliTokens ? targetMilliTokens : totalMilliTokens;
  return {
    totalMilliTokens,
    percentage: Number((bounded * 10_000n) / targetMilliTokens) / 100,
    wholePercentage: Number((bounded * 100n) / targetMilliTokens),
  };
}
