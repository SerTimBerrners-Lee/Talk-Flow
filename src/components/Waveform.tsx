import { useEffect, useRef } from "react";

interface WaveformProps {
  stream: MediaStream | null;
  isActive: boolean;
}

interface WaveLineConfig {
  amplitude: number;
  speed: number;
  phase: number;
  alpha: number;
  width: number;
  wobble: number;
}

const WAVEFORM_LINES: WaveLineConfig[] = [
  { amplitude: 1.14, speed: 1.34, phase: 0.18, alpha: 0.32, width: 0.7, wobble: 0.9 },
  { amplitude: 0.9, speed: 0.82, phase: 1.7, alpha: 0.25, width: 0.62, wobble: 1.8 },
  { amplitude: 1.24, speed: 1.12, phase: 2.85, alpha: 0.2, width: 0.56, wobble: 1.2 },
  { amplitude: 0.72, speed: 1.58, phase: 4.1, alpha: 0.16, width: 0.5, wobble: 2.4 },
];

const FRAME_INTERVAL_MS = 1000 / 30;
const DRAW_STEP_PX = 3.5;

export function Waveform({ stream, isActive }: WaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const levelRef = useRef(0);

  useEffect(() => {
    if (!stream || !isActive) {
      cancelAnimationFrame(animRef.current);
      levelRef.current = 0;
      drawEmpty();
      return;
    }

    const audioCtx = new AudioContext({ latencyHint: "interactive" });
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.35;

    const source = audioCtx.createMediaStreamSource(stream);
    source.connect(analyser);

    const dataArray = new Uint8Array(analyser.fftSize);
    let lastDrawTime = 0;

    const draw = (now: number) => {
      animRef.current = requestAnimationFrame(draw);
      if (now - lastDrawTime < FRAME_INTERVAL_MS) return;
      lastDrawTime = now;

      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d")!;

      // Use actual display dimensions
      const dpr = window.devicePixelRatio || 1;
      const displayWidth = canvas.clientWidth;
      const displayHeight = canvas.clientHeight;

      if (canvas.width !== displayWidth * dpr || canvas.height !== displayHeight * dpr) {
        canvas.width = displayWidth * dpr;
        canvas.height = displayHeight * dpr;
        ctx.scale(dpr, dpr);
      }

      analyser.getByteTimeDomainData(dataArray);
      ctx.clearRect(0, 0, displayWidth, displayHeight);

      let sumSquares = 0;
      for (let i = 0; i < dataArray.length; i++) {
        const normalized = (dataArray[i] - 128) / 128;
        sumSquares += normalized * normalized;
      }

      const rms = Math.sqrt(sumSquares / dataArray.length);
      const boostedLevel = Math.pow(Math.min(1, rms * 12.5), 0.54);
      const quietFloor = rms > 0.003 ? 0.14 : 0;
      const levelTarget = Math.max(quietFloor, boostedLevel);
      levelRef.current = levelRef.current * 0.44 + levelTarget * 0.56;

      const time = now / 420;
      const centerY = displayHeight / 2;
      const baseAmplitude = 0.7 + levelRef.current * displayHeight * 0.26;

      ctx.lineCap = "round";
      ctx.lineJoin = "round";

      WAVEFORM_LINES.forEach((line) => {
        ctx.beginPath();

        for (let x = 0; x <= displayWidth; x += DRAW_STEP_PX) {
          const progress = x / displayWidth;
          const edgeFade = Math.sin(progress * Math.PI);
          const envelope = Math.pow(Math.max(0, edgeFade), 1.08);
          const drift = Math.sin(time * 0.37 + line.phase) * 0.18;
          const primary = Math.sin(progress * Math.PI * (3.1 + line.wobble * 0.18) + time * line.speed + line.phase);
          const secondary = Math.sin(progress * Math.PI * (7.3 + line.wobble * 0.42) - time * (line.speed * 0.83) + line.phase * 1.37);
          const tertiary = Math.cos(progress * Math.PI * (13.4 + line.wobble * 0.31) + time * (0.56 + line.wobble * 0.04) + line.phase);
          const grain = Math.sin((progress + line.phase) * 38 + time * (1.1 + line.wobble * 0.11)) * 0.055;
          const displacement = ((primary * 0.52) + (secondary * 0.31) + (tertiary * 0.12) + grain + drift) * baseAmplitude * line.amplitude * envelope;
          const y = centerY + displacement;

          if (x === 0) {
            ctx.moveTo(x, y);
          } else {
            ctx.lineTo(x, y);
          }
        }

        ctx.strokeStyle = `rgba(0, 0, 0, ${line.alpha})`;
        ctx.lineWidth = line.width;
        ctx.shadowBlur = 0;
        ctx.stroke();
      });

      ctx.shadowBlur = 0;
    };

    void audioCtx.resume().catch(() => {});
    draw(performance.now());

    return () => {
      cancelAnimationFrame(animRef.current);
      source.disconnect();
      audioCtx.close();
      levelRef.current = 0;
    };
  }, [stream, isActive]);

  function drawEmpty() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  return (
    <canvas
      ref={canvasRef}
      style={{ width: "100%", height: "100%", display: "block" }}
    />
  );
}
