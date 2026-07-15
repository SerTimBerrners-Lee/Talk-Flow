import type {
  HotkeyChangeRequestPayload,
  HotkeyRegistrationResultPayload,
  HotkeyTarget,
} from "../../../lib/hotkeyEvents";
import {
  normalizeHotkey,
  type AppSettingsPatch,
  type AppSettings,
} from "../../../lib/store";

export type HotkeyTransactionStage =
  | "validate"
  | "conflict"
  | "register"
  | "save"
  | "unregister-old"
  | "rollback"
  | "complete"
  | "stale";

export interface HotkeyTransactionDependencies {
  loadSettings: () => Promise<AppSettings>;
  saveSettings: (patch: AppSettingsPatch) => Promise<void>;
  registerHotkey: (hotkey: string) => Promise<void>;
  unregisterHotkey: (hotkey: string) => Promise<void>;
  getActiveHotkey: (target: HotkeyTarget) => string | null;
  setActiveHotkey: (target: HotkeyTarget, hotkey: string | null) => void;
  isCurrentRequest: (target: HotkeyTarget, requestId: string) => boolean;
  log: (
    stage: HotkeyTransactionStage,
    request: HotkeyChangeRequestPayload,
    message: string,
  ) => void;
  messages: {
    conflict: string;
    registerFailed: (hotkey: string) => string;
    saveFailed: string;
    stale: string;
  };
}

function configuredHotkey(settings: AppSettings, target: HotkeyTarget): string {
  return target === "dictation"
    ? settings.hotkey
    : settings.translation.selectionHotkey;
}

function settingsPatch(
  target: HotkeyTarget,
  hotkey: string,
): AppSettingsPatch {
  if (target === "dictation") {
    return { hotkey };
  }

  return {
    translation: {
      selectionEnabled: true,
      selectionHotkey: hotkey,
    },
  };
}

function rollbackPatch(
  settings: AppSettings,
  target: HotkeyTarget,
): AppSettingsPatch {
  return target === "dictation"
    ? { hotkey: settings.hotkey }
    : {
        translation: {
          selectionEnabled: settings.translation.selectionEnabled,
          selectionHotkey: settings.translation.selectionHotkey,
        },
      };
}

function result(
  request: HotkeyChangeRequestPayload,
  success: boolean,
  requestedHotkey: string,
  activeHotkey: string,
  message?: string,
): HotkeyRegistrationResultPayload {
  return {
    requestId: request.requestId,
    target: request.target,
    success,
    requestedHotkey,
    activeHotkey,
    message,
  };
}

async function safeUnregister(
  hotkey: string,
  dependencies: HotkeyTransactionDependencies,
  request: HotkeyChangeRequestPayload,
): Promise<void> {
  try {
    await dependencies.unregisterHotkey(hotkey);
  } catch (error) {
    dependencies.log(
      "rollback",
      request,
      `unregister failed: ${String(error)}`,
    );
  }
}

export async function applyHotkeyTransaction(
  request: HotkeyChangeRequestPayload,
  dependencies: HotkeyTransactionDependencies,
): Promise<HotkeyRegistrationResultPayload> {
  dependencies.log("validate", request, `candidate=${request.hotkey}`);
  const normalized = normalizeHotkey(request.hotkey);
  const initialSettings = await dependencies.loadSettings();
  const configuredCurrent =
    normalizeHotkey(configuredHotkey(initialSettings, request.target))
      .normalized ?? configuredHotkey(initialSettings, request.target);
  const registeredCurrent = dependencies.getActiveHotkey(request.target);
  const activeCurrent =
    registeredCurrent ?? configuredCurrent;

  if (!normalized.valid || !normalized.normalized) {
    return result(
      request,
      false,
      request.hotkey,
      activeCurrent,
      normalized.error,
    );
  }

  const nextHotkey = normalized.normalized;
  if (!dependencies.isCurrentRequest(request.target, request.requestId)) {
    dependencies.log("stale", request, "ignored before registration");
    return result(
      request,
      false,
      nextHotkey,
      activeCurrent,
      dependencies.messages.stale,
    );
  }

  const otherTarget: HotkeyTarget =
    request.target === "dictation" ? "selection" : "dictation";
  const configuredOther =
    normalizeHotkey(configuredHotkey(initialSettings, otherTarget))
      .normalized ?? configuredHotkey(initialSettings, otherTarget);
  const activeOther = dependencies.getActiveHotkey(otherTarget);
  if (nextHotkey === configuredOther || nextHotkey === activeOther) {
    dependencies.log("conflict", request, `conflictsWith=${otherTarget}`);
    return result(
      request,
      false,
      nextHotkey,
      activeCurrent,
      dependencies.messages.conflict,
    );
  }

  // Persistent settings are not evidence that the shortcut is currently
  // registered. This matters when a disabled selection shortcut is enabled
  // again with the same value: the runtime ref is null and the key must be
  // registered before the transaction can report success.
  const registeredNew = nextHotkey !== registeredCurrent;
  if (registeredNew) {
    dependencies.log("register", request, `hotkey=${nextHotkey}`);
    try {
      await dependencies.registerHotkey(nextHotkey);
    } catch (error) {
      dependencies.log("register", request, `failed=${String(error)}`);
      return result(
        request,
        false,
        nextHotkey,
        activeCurrent,
        dependencies.messages.registerFailed(nextHotkey),
      );
    }
  }

  if (!dependencies.isCurrentRequest(request.target, request.requestId)) {
    dependencies.log("stale", request, "rolling back registered candidate");
    if (registeredNew) {
      await safeUnregister(nextHotkey, dependencies, request);
    }
    return result(
      request,
      false,
      nextHotkey,
      activeCurrent,
      dependencies.messages.stale,
    );
  }

  dependencies.log("save", request, `hotkey=${nextHotkey}`);
  try {
    await dependencies.saveSettings(
      settingsPatch(request.target, nextHotkey),
    );
  } catch (error) {
    dependencies.log("rollback", request, `save failed: ${String(error)}`);
    if (registeredNew) {
      await safeUnregister(nextHotkey, dependencies, request);
    }
    return result(
      request,
      false,
      nextHotkey,
      activeCurrent,
      dependencies.messages.saveFailed,
    );
  }

  if (!dependencies.isCurrentRequest(request.target, request.requestId)) {
    dependencies.log("stale", request, "rolling back saved candidate");
    try {
      await dependencies.saveSettings(
        rollbackPatch(initialSettings, request.target),
      );
    } catch (error) {
      dependencies.log(
        "rollback",
        request,
        `settings rollback failed: ${String(error)}`,
      );
    }
    if (registeredNew) {
      await safeUnregister(nextHotkey, dependencies, request);
    }
    return result(
      request,
      false,
      nextHotkey,
      activeCurrent,
      dependencies.messages.stale,
    );
  }

  if (registeredNew && registeredCurrent && registeredCurrent !== nextHotkey) {
    dependencies.log("unregister-old", request, `hotkey=${registeredCurrent}`);
    try {
      await dependencies.unregisterHotkey(registeredCurrent);
    } catch (error) {
      dependencies.log(
        "rollback",
        request,
        `old unregister failed: ${String(error)}`,
      );
      try {
        await dependencies.saveSettings(
          rollbackPatch(initialSettings, request.target),
        );
      } catch (rollbackError) {
        dependencies.log(
          "rollback",
          request,
          `settings rollback failed: ${String(rollbackError)}`,
        );
      }
      await safeUnregister(nextHotkey, dependencies, request);
      return result(
        request,
        false,
        nextHotkey,
        registeredCurrent,
        dependencies.messages.saveFailed,
      );
    }
  }

  dependencies.setActiveHotkey(request.target, nextHotkey);
  dependencies.log("complete", request, `active=${nextHotkey}`);
  return result(request, true, nextHotkey, nextHotkey);
}
