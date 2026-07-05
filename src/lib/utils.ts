export function cn(...classes: (string | undefined | null | false)[]) {
  return classes.filter(Boolean).join(" ");
}

export function formatErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

export function formatDurationMs(ms: number, lang: "ru" | "en" = "ru"): string {
  const safeMs = Number.isFinite(ms) ? Math.max(0, ms) : 0;
  const totalSeconds = safeMs > 0 ? Math.max(1, Math.round(safeMs / 1000)) : 0;
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (lang === "en") {
    if (hours > 0) {
      return `${hours} h ${minutes} min ${seconds} s`;
    }
    if (minutes > 0) {
      return `${minutes} min ${seconds} s`;
    }
    return `${seconds} s`;
  }

  if (hours > 0) {
    return `${hours} час ${minutes} мин ${seconds} с`;
  }
  if (minutes > 0) {
    return `${minutes} мин ${seconds} с`;
  }
  return `${seconds} с`;
}
