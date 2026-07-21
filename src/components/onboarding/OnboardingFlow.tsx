import { useState } from "react";

import type { AppSettings } from "../../lib/store";
import { PermissionScreen } from "../PermissionScreen";
import { OnboardingModelStep } from "./OnboardingModelStep";
import { OnboardingTestStep } from "./OnboardingTestStep";

type OnboardingStep = "permissions" | "model" | "test";

export function OnboardingFlow({
  onComplete,
}: {
  onComplete: () => Promise<void> | void;
}) {
  const [step, setStep] = useState<OnboardingStep>("permissions");
  const [settings, setSettings] = useState<AppSettings | null>(null);

  if (step === "permissions") {
    return (
      <PermissionScreen
        onboardingStep={0}
        onComplete={() => setStep("model")}
      />
    );
  }

  if (step === "model") {
    return (
      <OnboardingModelStep
        onContinue={(nextSettings) => {
          setSettings(nextSettings);
          setStep("test");
        }}
        onSkip={() => void onComplete()}
      />
    );
  }

  if (!settings) {
    return (
      <OnboardingModelStep
        onContinue={setSettings}
        onSkip={() => void onComplete()}
      />
    );
  }

  return (
    <OnboardingTestStep
      settings={settings}
      onBack={() => setStep("model")}
      onComplete={() => void onComplete()}
    />
  );
}
