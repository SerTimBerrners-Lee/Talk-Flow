import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from "react";

import { IconLoader2, IconPause, IconPlayerPlay } from "../lib/icons";
import { logError } from "../lib/logger";
import { readHistoryAudio, type HistoryEntry } from "../lib/store";
import { useI18n } from "../lib/i18n";

interface AudioTrackSource {
  id: string;
  label: string;
  path?: string;
  audioBase64?: string;
  mimeType?: string;
  fileName?: string;
}

interface HistoryAudioTrackProps {
  entry: HistoryEntry;
  activeAudioId: string | null;
  onActiveAudioChange: (id: string | null) => void;
}

function base64ToBlob(base64: string, mimeType: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return new Blob([bytes], { type: mimeType });
}

function formatAudioTime(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    return "0:00";
  }

  const totalSeconds = Math.floor(value);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function buildTrackSources(entry: HistoryEntry): AudioTrackSource[] {
  if (entry.source === "call" && entry.callTracks?.length) {
    const tracks = [...entry.callTracks].sort((a, b) => {
      if (a.kind === b.kind) return 0;
      return a.kind === "system" ? -1 : 1;
    });

    return tracks.map((track) => ({
      id: track.kind,
      label: track.label,
      path: track.path,
      mimeType: "audio/wav",
      fileName: `${track.kind}.wav`,
    }));
  }

  if (entry.audioPath) {
    return [
      {
        id: "voice",
        label: "",
        path: entry.audioPath,
        mimeType: entry.audioMimeType,
        fileName: entry.audioFileName,
      },
    ];
  }

  if (entry.audioBase64) {
    return [
      {
        id: "voice",
        label: "",
        audioBase64: entry.audioBase64,
        mimeType: entry.audioMimeType,
        fileName: entry.audioFileName,
      },
    ];
  }

  return [];
}

export function HistoryAudioTrack({
  entry,
  activeAudioId,
  onActiveAudioChange,
}: HistoryAudioTrackProps): ReactElement | null {
  const { t } = useI18n();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  const sources = useMemo(() => buildTrackSources(entry), [entry]);
  const selectedSource = sources[0] ?? null;
  const ownAudioId = selectedSource ? `${entry.id}:${selectedSource.id}` : null;

  useEffect(() => {
    return () => {
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    if (activeAudioId !== ownAudioId && !audio.paused) {
      audio.pause();
    }
  }, [activeAudioId, ownAudioId]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    audio.pause();
    audio.removeAttribute("src");
    audio.load();
    setPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    setError(false);

    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
  }, [entry.id, selectedSource?.id]);

  if (!selectedSource || !ownAudioId) {
    return null;
  }

  const loadSource = async (): Promise<boolean> => {
    if (objectUrlRef.current && audioRef.current?.src) {
      return true;
    }

    setLoading(true);
    setError(false);

    try {
      const audioData = selectedSource.path
        ? await readHistoryAudio(selectedSource.path)
        : {
            audioBase64: selectedSource.audioBase64 || "",
            mimeType: selectedSource.mimeType || "audio/webm",
          };

      if (!audioData.audioBase64) {
        throw new Error("Audio data is empty");
      }

      const blob = base64ToBlob(
        audioData.audioBase64,
        audioData.mimeType || selectedSource.mimeType || "audio/webm",
      );
      const objectUrl = URL.createObjectURL(blob);

      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
      }
      objectUrlRef.current = objectUrl;

      if (audioRef.current) {
        audioRef.current.src = objectUrl;
        audioRef.current.load();
      }
      return true;
    } catch (loadError) {
      setError(true);
      void logError(
        "HISTORY",
        `Failed to load history audio: ${loadError instanceof Error ? loadError.message : String(loadError)}`,
      );
      return false;
    } finally {
      setLoading(false);
    }
  };

  const togglePlayback = async (): Promise<void> => {
    const audio = audioRef.current;
    if (!audio) return;

    if (!audio.paused) {
      audio.pause();
      onActiveAudioChange(null);
      return;
    }

    const loaded = await loadSource();
    if (!loaded || !audioRef.current?.src) {
      return;
    }

    try {
      onActiveAudioChange(ownAudioId);
      await audioRef.current.play();
    } catch (playError) {
      onActiveAudioChange(null);
      setError(true);
      void logError(
        "HISTORY",
        `Failed to play history audio: ${playError instanceof Error ? playError.message : String(playError)}`,
      );
    }
  };

  return (
    <div
      style={{
        display: "grid",
        gap: 6,
        minWidth: 0,
        width: "100%",
      }}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "28px minmax(160px, 420px)",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
          minWidth: 0,
          width: "100%",
        }}
      >
        <button
          type="button"
          className="btn"
          onClick={() => {
            void togglePlayback();
          }}
          style={{
            width: 28,
            minWidth: 28,
            height: 28,
            minHeight: 28,
            padding: 0,
            borderRadius: 8,
          }}
          title={playing ? t("mainTab.audioPause") : t("mainTab.audioPlay")}
          aria-label={playing ? t("mainTab.audioPause") : t("mainTab.audioPlay")}
        >
          {loading ? (
            <IconLoader2 className="loading-soft-icon" size={12} stroke={2} />
          ) : playing ? (
            <IconPause size={12} stroke={2.4} />
          ) : (
            <IconPlayerPlay size={12} stroke={2.4} />
          )}
        </button>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "max-content minmax(0, 1fr) max-content",
            alignItems: "center",
            gap: 8,
            minWidth: 0,
            height: 28,
          }}
        >
          <span
            style={{
              color: "var(--text-low)",
              fontSize: 10,
              fontVariantNumeric: "tabular-nums",
              lineHeight: 1,
            }}
          >
            {formatAudioTime(currentTime)}
          </span>
          <input
            type="range"
            min={0}
            max={duration || 0}
            step={0.1}
            value={duration ? Math.min(currentTime, duration) : 0}
            onChange={(event) => {
              const audio = audioRef.current;
              if (!audio) return;
              const nextTime = Number(event.currentTarget.value);
              audio.currentTime = nextTime;
              setCurrentTime(nextTime);
            }}
            disabled={!duration}
            aria-label={t("mainTab.audioProgress")}
            style={{
              width: "100%",
              accentColor: "var(--accent)",
              cursor: duration ? "pointer" : "default",
              display: "block",
            }}
          />
          <span
            style={{
              color: error ? "var(--danger)" : "var(--text-low)",
              fontSize: 10,
              fontVariantNumeric: "tabular-nums",
              lineHeight: 1,
              minWidth: 0,
              maxWidth: 94,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {error ? t("mainTab.audioLoadFailed") : formatAudioTime(duration)}
          </span>
        </div>
      </div>

      <audio
        ref={audioRef}
        preload="metadata"
        onLoadedMetadata={(event) => {
          setDuration(event.currentTarget.duration || 0);
        }}
        onTimeUpdate={(event) => {
          setCurrentTime(event.currentTarget.currentTime || 0);
        }}
        onPlay={() => {
          setPlaying(true);
          onActiveAudioChange(ownAudioId);
        }}
        onPause={() => {
          setPlaying(false);
          setCurrentTime(audioRef.current?.currentTime || 0);
        }}
        onEnded={() => {
          setPlaying(false);
          setCurrentTime(0);
          onActiveAudioChange(null);
        }}
        style={{ display: "none" }}
      />
    </div>
  );
}
