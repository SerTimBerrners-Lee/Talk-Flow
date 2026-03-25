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

    const audioCtx = new AudioContext();
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.88;

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
      const boostedLevel = Math.pow(Math.min(1, rms * 8.5), 0.55);
      const quietFloor = rms > 0.006 ? 0.12 : 0;
      const levelTarget = Math.max(quietFloor, boostedLevel);
      levelRef.current = levelRef.current * 0.7 + levelTarget * 0.3;

      const time = performance.now() / 340;
      const centerY = displayHeight / 2;
      const baseAmplitude = 1.2 + levelRef.current * displayHeight * 0.34;
      const lineConfigs = [
        { amplitude: 1.28, speed: 1, phase: 0, alpha: 0.94, width: 2.4 },
        { amplitude: 1.08, speed: 1.16, phase: Math.PI / 5.2, alpha: 0.58, width: 1.9 },
        { amplitude: 0.92, speed: 1.32, phase: Math.PI / 2.9, alpha: 0.42, width: 1.55 },
        { amplitude: 0.78, speed: 0.86, phase: Math.PI / 1.9, alpha: 0.3, width: 1.3 },
        { amplitude: 0.66, speed: 1.54, phase: Math.PI / 1.35, alpha: 0.22, width: 1.1 },
        { amplitude: 0.56, speed: 0.68, phase: Math.PI / 1.08, alpha: 0.16, width: 1 },
      ];

      ctx.lineCap = "round";
      ctx.lineJoin = "round";

      lineConfigs.forEach((line) => {
        ctx.beginPath();

        for (let x = 0; x <= displayWidth; x += 2) {
          const progress = x / displayWidth;
          const envelope = Math.sin(progress * Math.PI);
          const primary = Math.sin(progress * Math.PI * 2.1 + time * line.speed + line.phase);
          const secondary = Math.sin(progress * Math.PI * 4.2 - time * (line.speed * 1.15) + line.phase * 0.65);
          const tertiary = Math.cos(progress * Math.PI * 6.4 + time * 0.8 + line.phase);
          const y = centerY + ((primary * 0.72) + (secondary * 0.2) + (tertiary * 0.08)) * baseAmplitude * line.amplitude * envelope;

          if (x === 0) {
            ctx.moveTo(x, y);
          } else {
            ctx.lineTo(x, y);
          }
        }

        ctx.strokeStyle = `rgba(0, 0, 0, ${line.alpha})`;
        ctx.lineWidth = line.width;
        ctx.shadowBlur = line.alpha > 0.85 ? 12 : line.alpha > 0.5 ? 6 : 0;
        ctx.shadowColor = "rgba(0, 0, 0, 0.12)";
        ctx.stroke();
      });

      ctx.shadowBlur = 0;
    };

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
