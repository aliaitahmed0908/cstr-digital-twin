import { useEffect, useRef } from "react";

interface TelemetryChartProps {
  getCa: () => number;
  getT: () => number;
  windowSeconds?: number;
  caMax?: number;
  tMin?: number;
  tMax?: number;
}

const HISTORY_LEN = 300;

export function TelemetryChart({
  getCa,
  getT,
  windowSeconds = 30,
  caMax = 1.0,
  tMin = 260,
  tMax = 460,
}: TelemetryChartProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const caHistory = useRef<Float64Array>(new Float64Array(HISTORY_LEN));
  const tHistory = useRef<Float64Array>(new Float64Array(HISTORY_LEN));
  const writeIndex = useRef(0);
  const filled = useRef(0);
  const lastSampleTime = useRef(0);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const sampleIntervalMs = (windowSeconds * 1000) / HISTORY_LEN;

    const draw = (now: number) => {
      if (now - lastSampleTime.current >= sampleIntervalMs) {
        lastSampleTime.current = now;
        const idx = writeIndex.current % HISTORY_LEN;
        caHistory.current[idx] = getCa();
        tHistory.current[idx] = getT();
        writeIndex.current++;
        filled.current = Math.min(filled.current + 1, HISTORY_LEN);
      }

      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      const w = rect.width;
      const h = rect.height;
      if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
        canvas.width = w * dpr;
        canvas.height = h * dpr;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      // Grid lines
      ctx.strokeStyle = "#1a2230";
      ctx.lineWidth = 1;
      for (let i = 1; i < 4; i++) {
        const y = (h / 4) * i;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }

      const count = filled.current;
      if (count > 1) {
        const startIdx = writeIndex.current - count;

        const plotLine = (
          data: Float64Array,
          minVal: number,
          maxVal: number,
          color: string
        ) => {
          ctx.beginPath();
          ctx.strokeStyle = color;
          ctx.lineWidth = 2;
          for (let i = 0; i < count; i++) {
            const idx = (startIdx + i + HISTORY_LEN * 2) % HISTORY_LEN;
            const val = data[idx];
            const x = (i / (HISTORY_LEN - 1)) * w;
            const norm = (val - minVal) / (maxVal - minVal);
            const y = h - Math.max(0, Math.min(1, norm)) * h;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.stroke();
        };

        plotLine(tHistory.current, tMin, tMax, "#ff6b52");
        plotLine(caHistory.current, 0, caMax, "#3ba8ff");
      }

      rafRef.current = requestAnimationFrame(draw);
    };

    rafRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafRef.current);
  }, [getCa, getT, windowSeconds, caMax, tMin, tMax]);

  return (
    <div style={{ width: "100%" }}>
      <div style={{ display: "flex", gap: 16, marginBottom: 6, fontSize: 11 }}>
        <LegendDot color="#ff6b52" label={`Temperature (${tMin}–${tMax} K)`} />
        <LegendDot color="#3ba8ff" label={`Concentration (0–${caMax} mol/L)`} />
      </div>
      <canvas
        ref={canvasRef}
        style={{
          width: "100%",
          height: 140,
          display: "block",
          borderRadius: 8,
          background: "#0a0d13",
          border: "1px solid #1f2733",
        }}
      />
    </div>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 5, color: "#8a94a6" }}>
      <span style={{ width: 8, height: 8, borderRadius: "50%", background: color, display: "inline-block" }} />
      {label}
    </div>
  );
}