export function normalizePracticeText(value: string): string {
  return value
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function isPracticePhraseMatch(
  actual: string,
  expected: string,
): boolean {
  const normalizedActual = normalizePracticeText(actual);
  const normalizedExpected = normalizePracticeText(expected);

  if (!normalizedActual || !normalizedExpected) {
    return false;
  }

  if (
    normalizedActual.includes(normalizedExpected) ||
    normalizedExpected.includes(normalizedActual)
  ) {
    return normalizedActual.length >= Math.min(12, normalizedExpected.length);
  }

  const actualWords = new Set(normalizedActual.split(" "));
  const expectedWords = normalizedExpected.split(" ");
  const matchingWords = expectedWords.filter((word) =>
    actualWords.has(word),
  ).length;

  return matchingWords / expectedWords.length >= 0.55;
}
