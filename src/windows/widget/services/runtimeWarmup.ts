export type RuntimeWarmUpValue = string | null | false;

export interface RuntimeWarmUpWithinBudgetResult {
  value: RuntimeWarmUpValue;
  timedOut: boolean;
}

export async function waitForRuntimeWarmUpWithinBudget(
  warmUp: Promise<RuntimeWarmUpValue>,
  budgetMs: number,
): Promise<RuntimeWarmUpWithinBudgetResult> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<RuntimeWarmUpWithinBudgetResult>((resolve) => {
    timer = setTimeout(
      () => resolve({ value: null, timedOut: true }),
      Math.max(0, budgetMs),
    );
  });

  try {
    return await Promise.race([
      warmUp.then((value) => ({ value, timedOut: false })),
      timeout,
    ]);
  } finally {
    if (timer !== null) {
      clearTimeout(timer);
    }
  }
}
