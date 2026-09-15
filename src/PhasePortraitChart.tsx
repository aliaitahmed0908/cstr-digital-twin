import { useEffect, useRef } from "react";

interface PhasePortraitChartProps {
  getCa: () => number;
  getT: () => number;
  caMin?: number;
  caMax?: number;
  tMin?: number;
  tMax?: number;
  trailLength?: number;
}

export function PhasePortraitChart({
  getCa,
  getT,
  caMin = 0,
  caMax = 1.0,
  tMin = 260,
  tMax = 460,
  trailLength = 150,
}: PhasePortraitChartProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const caTrail = useRef<Float64Array>(new Float64Array(trailLength));
  const tTrail = useRef<Float64Array>(new Float64Array(trailLength));
  const writeIndex = useRef(0);
  const filled = useRef(0);
  const lastSampleTime = useRef(0);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const sampleIntervalMs = 100;

    const toXY = (Ca: number, T: number, w: number, h: number) => {
      const x = ((Ca - caMin) / (caMax - caMin)) * w;
      const y = h - ((T - tMin) / (tMax - tMin)) * h;
      return [x, y];
    };

    const draw = (now: number) => {
      if (now - lastSampleTime.current >= sampleIntervalMs) {
        lastSampleTime.current = now;
        const idx = writeIndex.current % trailLength;
        caTrail.current[idx] = getCa();
        tTrail.current[idx] = getT();
        writeIndex.current++;
        filled.current = Math.min(filled.current + 1, trailLength);
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

      ctx.strokeStyle = "#1a2230";
      ctx.lineWidth = 1;
      for (let i = 1; i < 4; i++) {
        const gx = (w / 4) * i;
        const gy = (h / 4) * i;
        ctx.beginPath();
        ctx.moveTo(gx, 0);
        ctx.lineTo(gx, h);
        ctx.moveTo(0, gy);
        ctx.lineTo(w, gy);
        ctx.stroke();
      }

      const count = filled.current;
      if (count > 1) {
        const startIdx = writeIndex.current - count;

        for (let i = 1; i < count; i++) {
          const idxPrev = (startIdx + i - 1 + trailLength * 2) % trailLength;
          const idxCurr = (startIdx + i + trailLength * 2) % trailLength;
          const [x1, y1] = toXY(caTrail.current[idxPrev], tTrail.current[idxPrev], w, h);
          const [x2, y2] = toXY(caTrail.current[idxCurr], tTrail.current[idxCurr], w, h);
          const alpha = i / count;
          ctx.strokeStyle = `rgba(167, 139, 250, ${alpha * 0.8})`;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
          ctx.stroke();
        }

        const lastIdx = (writeIndex.current - 1 + trailLength * 2) % trailLength;
        const [cx, cy] = toXY(caTrail.current[lastIdx], tTrail.current[lastIdx], w, h);
        ctx.beginPath();
        ctx.arc(cx, cy, 5, 0, Math.PI * 2);
        ctx.fillStyle = "#a78bfa";
        ctx.shadowColor = "#a78bfa";
        ctx.shadowBlur = 8;
        ctx.fill();
        ctx.shadowBlur = 0;
      }

      rafRef.current = requestAnimationFrame(draw);
    };

    rafRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafRef.current);
  }, [getCa, getT, caMin, caMax, tMin, tMax, trailLength]);

  return (
    <div style={{ width: "100%" }}>
      <canvas
        ref={canvasRef}
        style={{
          width: "100%",
          height: 160,
          display: "block",
          borderRadius: 8,
          background: "#0a0d13",
          border: "1px solid #1f2733",
        }}
      />
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#5b6577", marginTop: 4 }}>
        <span>Ca: {caMin.toFixed(1)}–{caMax.toFixed(1)} mol/L</span>
        <span>T: {tMin}–{tMax} K</span>
      </div>
    </div>
  );
}