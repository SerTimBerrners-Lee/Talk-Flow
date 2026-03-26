import { useEffect, useRef } from "react";

interface WaveformProps {
  stream: MediaStream | null;
  isActive: boolean;
}

export function Waveform({ stream, isActive }: WaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const levelRef = useRef(0);

  useEffect(() => {
    if (!stream || !isActive) {
      cancelAnimationFrame(animRef.current);
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

    const draw = () => {
      animRef.current = requestAnimationFrame(draw);
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
      const boostedLevel = Math.pow(Math.min(1, rms * 10.5), 0.58);
      const quietFloor = rms > 0.003 ? 0.1 : 0;
      const levelTarget = Math.max(quietFloor, boostedLevel);
      levelRef.current = levelRef.current * 0.5 + levelTarget * 0.5;

      const time = performance.now() / 420;
      const centerY = displayHeight / 2;
      const baseAmplitude = 0.7 + levelRef.current * displayHeight * 0.22;
      const lineConfigs = [
        { amplitude: 1.22, speed: 1, phase: 0, alpha: 0.34, width: 1.1 },
        { amplitude: 1.14, speed: 1.08, phase: Math.PI / 8, alpha: 0.3, width: 1 },
        { amplitude: 1.06, speed: 1.16, phase: Math.PI / 5.5, alpha: 0.27, width: 0.95 },
        { amplitude: 0.98, speed: 1.24, phase: Math.PI / 4.2, alpha: 0.24, width: 0.9 },
        { amplitude: 0.9, speed: 0.92, phase: Math.PI / 3.3, alpha: 0.21, width: 0.85 },
        { amplitude: 0.82, speed: 1.32, phase: Math.PI / 2.8, alpha: 0.19, width: 0.8 },
        { amplitude: 0.75, speed: 0.84, phase: Math.PI / 2.25, alpha: 0.17, width: 0.78 },
        { amplitude: 0.68, speed: 1.42, phase: Math.PI / 1.9, alpha: 0.15, width: 0.72 },
        { amplitude: 0.61, speed: 0.74, phase: Math.PI / 1.6, alpha: 0.13, width: 0.68 },
        { amplitude: 0.54, speed: 1.54, phase: Math.PI / 1.35, alpha: 0.11, width: 0.64 },
        { amplitude: 0.48, speed: 0.66, phase: Math.PI / 1.14, alpha: 0.1, width: 0.6 },
        { amplitude: 0.42, speed: 1.68, phase: Math.PI / 1.02, alpha: 0.09, width: 0.56 },
      ];

      ctx.lineCap = "round";
      ctx.lineJoin = "round";

      lineConfigs.forEach((line) => {
        ctx.beginPath();

          for (let x = 0; x <= displayWidth; x += 1) {
            const progress = x / displayWidth;
            const envelope = 0.72 + Math.sin(progress * Math.PI) * 0.28;
            const primary = Math.sin(progress * Math.PI * 2.8 + time * line.speed + line.phase);
            const secondary = Math.sin(progress * Math.PI * 5.6 - time * (line.speed * 1.08) + line.phase * 0.72);
            const tertiary = Math.cos(progress * Math.PI * 8.2 + time * 0.74 + line.phase);
            const y = centerY + ((primary * 0.68) + (secondary * 0.22) + (tertiary * 0.1)) * baseAmplitude * line.amplitude * envelope;

          if (x === 0) {
            ctx.moveTo(x, y);
          } else {
            ctx.lineTo(x, y);
          }
        }

          ctx.strokeStyle = `rgba(0, 0, 0, ${line.alpha})`;
          ctx.lineWidth = line.width;
          ctx.shadowBlur = line.alpha > 0.28 ? 4 : 0;
          ctx.shadowColor = "rgba(0, 0, 0, 0.08)";
          ctx.stroke();
        });

      ctx.shadowBlur = 0;
    };

    void audioCtx.resume().catch(() => {});
    draw();

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
