import { useEffect, useRef, useState, type ReactElement } from "react";

interface SpeakerNameInputProps {
  value: string;
  ariaLabel: string;
  onCommit: (value: string) => Promise<void> | void;
  readOnly?: boolean;
}

export function SpeakerNameInput({
  value,
  ariaLabel,
  onCommit,
  readOnly = false,
}: SpeakerNameInputProps): ReactElement {
  const [draft, setDraft] = useState(value);
  const focusedRef = useRef(false);
  const cancelledRef = useRef(false);

  useEffect(() => {
    if (!focusedRef.current) {
      setDraft(value);
    }
  }, [value]);

  const commit = (): void => {
    if (readOnly) return;
    focusedRef.current = false;
    if (cancelledRef.current) {
      cancelledRef.current = false;
      setDraft(value);
      return;
    }

    const nextValue = draft.trim();
    if (!nextValue) {
      setDraft(value);
      return;
    }
    if (nextValue !== value) {
      void onCommit(nextValue);
    }
  };

  return (
    <input
      className="input"
      value={draft}
      readOnly={readOnly}
      onFocus={() => {
        if (!readOnly) {
          focusedRef.current = true;
        }
      }}
      onChange={(event) => {
        if (!readOnly) {
          setDraft(event.currentTarget.value);
        }
      }}
      onBlur={commit}
      onKeyDown={(event) => {
        if (readOnly) return;
        if (event.key === "Enter") {
          event.currentTarget.blur();
        } else if (event.key === "Escape") {
          cancelledRef.current = true;
          event.currentTarget.blur();
        }
      }}
      style={{
        width: 140,
        height: 34,
        padding: "7px 10px",
        fontSize: 12,
        fontWeight: 650,
        cursor: readOnly ? "default" : undefined,
      }}
      aria-label={ariaLabel}
    />
  );
}
