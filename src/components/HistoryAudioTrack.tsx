import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";

import { IconLoader2, IconPause, IconPlayerPlay } from "../lib/icons";
import { logError } from "../lib/logger";
import { readHistoryAudio, type HistoryEntry } from "../lib/store";
import { useI18n } from "../lib/i18n";

export interface AudioTrackSource {
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

function AudioTrackControls({
  loading,
  playing,
  error,
  currentTime,
  duration,
  onTogglePlayback,
  onSeek,
}: {
  loading: boolean;
  playing: boolean;
  error: boolean;
  currentTime: number;
  duration: number;
  onTogglePlayback: () => void;
  onSeek?: (time: number) => void;
}): ReactElement {
  const { t } = useI18n();
  const canSeek = duration > 0 && Boolean(onSeek);

  return (
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
        onClick={onTogglePlayback}
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
          max={duration > 0 ? duration : 1}
          step={0.1}
          value={duration > 0 ? Math.min(currentTime, duration) : 0}
          onChange={(event) => {
            if (!onSeek) return;
            onSeek(Number(event.currentTarget.value));
          }}
          disabled={!canSeek}
          aria-label={t("mainTab.audioProgress")}
          style={{
            width: "100%",
            accentColor: "var(--accent)",
            cursor: canSeek ? "pointer" : "default",
            display: "block",
            opacity: 1,
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
  );
}

export function HistoryAudioTrackPlaceholder({
  loading,
  onLoadRequested,
}: {
  loading: boolean;
  onLoadRequested: () => void;
}): ReactElement {
  return (
    <div style={{ display: "grid", gap: 6, minWidth: 0, width: "100%" }}>
      <AudioTrackControls
        loading={loading}
        playing={false}
        error={false}
        currentTime={0}
        duration={0}
        onTogglePlayback={onLoadRequested}
      />
    </div>
  );
}

export function buildHistoryAudioTrackSources(
  entry: HistoryEntry,
): AudioTrackSource[] {
  if (
    (entry.source === "call" || entry.source === "liveTranslation") &&
    entry.callTracks?.length
  ) {
    const tracks = [...entry.callTracks].sort((a, b) => {
      if (a.kind === b.kind) return 0;
      return a.kind === "system" ? -1 : 1;
    });

    return tracks.map((track) => ({
      id: track.kind,
      label: track.label,
      path: track.path,
      mimeType: track.path.toLowerCase().endsWith(".webm")
        ? "audio/webm"
        : "audio/wav",
      fileName: track.path.split(/[\\/]/).pop() || `${track.kind}.wav`,
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
  const audioRefs = useRef<Array<HTMLAudioElement | null>>([]);
  const objectUrlRefs = useRef<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  const sources = useMemo(() => buildHistoryAudioTrackSources(entry), [entry]);
  const sourceIds = sources.map((source) => source.id).join("+");
  const ownAudioId = sources.length > 0 ? `${entry.id}:${sourceIds}` : null;

  const revokeObjectUrls = (): void => {
    for (const url of objectUrlRefs.current) {
      URL.revokeObjectURL(url);
    }
    objectUrlRefs.current = [];
  };

  const pauseAllTracks = (): void => {
    for (const audio of audioRefs.current) {
      audio?.pause();
    }
  };

  useEffect(() => {
    return () => {
      revokeObjectUrls();
    };
  }, []);

  useEffect(() => {
    if (activeAudioId !== ownAudioId) {
      pauseAllTracks();
    }
  }, [activeAudioId, ownAudioId]);

  useEffect(() => {
    for (const audio of audioRefs.current) {
      if (!audio) continue;
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    }
    setPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    setError(false);
    revokeObjectUrls();
  }, [entry.id, sourceIds]);

  if (sources.length === 0 || !ownAudioId) {
    return null;
  }

  const loadSources = async (): Promise<boolean> => {
    const audioElements = audioRefs.current.slice(0, sources.length);
    if (
      objectUrlRefs.current.length === sources.length &&
      audioElements.every((audio) => Boolean(audio?.src))
    ) {
      return true;
    }

    setLoading(true);
    setError(false);

    try {
      const audioData = await Promise.all(
        sources.map((source) =>
          source.path
            ? readHistoryAudio(source.path)
            : Promise.resolve({
                audioBase64: source.audioBase64 || "",
                mimeType: source.mimeType || "audio/webm",
              }),
        ),
      );
      if (audioData.some((data) => !data.audioBase64)) {
        throw new Error("Audio data is empty");
      }

      const nextUrls = audioData.map((data, index) =>
        URL.createObjectURL(
          base64ToBlob(
            data.audioBase64,
            data.mimeType || sources[index]?.mimeType || "audio/webm",
          ),
        ),
      );
      revokeObjectUrls();
      objectUrlRefs.current = nextUrls;

      for (let index = 0; index < nextUrls.length; index += 1) {
        const audio = audioRefs.current[index];
        if (!audio) continue;
        audio.src = nextUrls[index];
        audio.load();
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
    const primaryAudio = audioRefs.current[0];
    if (!primaryAudio) return;

    if (!primaryAudio.paused) {
      pauseAllTracks();
      onActiveAudioChange(null);
      return;
    }

    const loaded = await loadSources();
    const tracks = audioRefs.current
      .slice(0, sources.length)
      .filter((audio): audio is HTMLAudioElement => Boolean(audio?.src));
    if (!loaded || tracks.length !== sources.length) {
      return;
    }

    try {
      const startTime = tracks[0].currentTime || 0;
      for (const audio of tracks.slice(1)) {
        audio.currentTime = Math.min(
          startTime,
          Number.isFinite(audio.duration) ? audio.duration : startTime,
        );
      }
      onActiveAudioChange(ownAudioId);
      await Promise.all(tracks.map((audio) => audio.play()));
    } catch (playError) {
      pauseAllTracks();
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
      <AudioTrackControls
        loading={loading}
        playing={playing}
        error={error}
        currentTime={currentTime}
        duration={duration}
        onTogglePlayback={() => {
          void togglePlayback();
        }}
        onSeek={(nextTime) => {
          for (const audio of audioRefs.current) {
            if (!audio) continue;
            audio.currentTime = Math.min(
              nextTime,
              Number.isFinite(audio.duration) ? audio.duration : nextTime,
            );
          }
          setCurrentTime(nextTime);
        }}
      />

      {sources.map((source, index) => (
        <audio
          key={source.id}
          ref={(audio) => {
            audioRefs.current[index] = audio;
          }}
          preload="metadata"
          onLoadedMetadata={
            index === 0
              ? (event) => {
                  setDuration(event.currentTarget.duration || 0);
                }
              : undefined
          }
          onTimeUpdate={
            index === 0
              ? (event) => {
                  const nextTime = event.currentTarget.currentTime || 0;
                  setCurrentTime(nextTime);
                  for (const audio of audioRefs.current.slice(1)) {
                    if (
                      audio &&
                      !audio.paused &&
                      Math.abs(audio.currentTime - nextTime) > 0.25
                    ) {
                      audio.currentTime = nextTime;
                    }
                  }
                }
              : undefined
          }
          onPlay={
            index === 0
              ? () => {
                  setPlaying(true);
                  onActiveAudioChange(ownAudioId);
                }
              : undefined
          }
          onPause={
            index === 0
              ? () => {
                  pauseAllTracks();
                  setPlaying(false);
                  setCurrentTime(audioRefs.current[0]?.currentTime || 0);
                }
              : undefined
          }
          onEnded={
            index === 0
              ? () => {
                  pauseAllTracks();
                  for (const audio of audioRefs.current) {
                    if (audio) audio.currentTime = 0;
                  }
                  setPlaying(false);
                  setCurrentTime(0);
                  onActiveAudioChange(null);
                }
              : undefined
          }
          style={{ display: "none" }}
        />
      ))}
    </div>
  );
}
