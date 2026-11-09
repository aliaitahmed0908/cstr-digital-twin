import { useEffect, useRef } from "react";

interface PhasePortraitChartProps {
  getCa: () => number;
  getT: () => number;
  caMin?: number;
  caMax?: number;
  tMin?: number;
  tMax?: number;
  tripTemp?: number;
  trailLength?: number;
}

export function PhasePortraitChart({
  getCa,
  getT,
  caMin = 0,
  caMax = 1.0,
  tMin = 260,
  tMax = 460,
  tripTemp = 440,
  trailLength = 150,
}: PhasePortraitChartProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  // High-performance ring buffer
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

    const draw = (now: number) => {
      // 1. Data Sampling (Ring Buffer)
      if (now - lastSampleTime.current >= sampleIntervalMs) {
        lastSampleTime.current = now;
        const idx = writeIndex.current % trailLength;
        caTrail.current[idx] = getCa();
        tTrail.current[idx] = getT();
        writeIndex.current++;
        filled.current = Math.min(filled.current + 1, trailLength);
      }

      // 2. High-DPI Canvas Setup
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

      // 3. Layout Padding for Axis Labels
      const padding = { top: 15, right: 15, bottom: 30, left: 45 };
      const plotW = w - padding.left - padding.right;
      const plotH = h - padding.top - padding.bottom;

      const mapCaToX = (val: number) =>
        padding.left + Math.max(0, Math.min(1, (val - caMin) / (caMax - caMin))) * plotW;
      const mapTempToY = (val: number) =>
        padding.top + plotH - Math.max(0, Math.min(1, (val - tMin) / (tMax - tMin))) * plotH;

      // Background fill
      ctx.fillStyle = "#0a0d13";
      ctx.fillRect(0, 0, w, h);

      // Grid Lines & Font Setup
      ctx.strokeStyle = "#1f2733";
      ctx.lineWidth = 1;
      ctx.fillStyle = "#5b6577";
      ctx.font = "10px monospace";

      // X-Axis (Ca) Grid & Ticks
      for (let i = 0; i <= 4; i++) {
        const v = caMin + (i / 4) * (caMax - caMin);
        const x = mapCaToX(v);
        ctx.beginPath();
        ctx.moveTo(x, padding.top);
        ctx.lineTo(x, padding.top + plotH);
        ctx.stroke();
        ctx.textAlign = "center";
        ctx.fillText(v.toFixed(2), x, padding.top + plotH + 14);
      }

      // Y-Axis (T) Grid & Ticks
      for (let i = 0; i <= 4; i++) {
        const v = tMin + (i / 4) * (tMax - tMin);
        const y = mapTempToY(v);
        ctx.beginPath();
        ctx.moveTo(padding.left, y);
        ctx.lineTo(padding.left + plotW, y);
        ctx.stroke();
        ctx.textAlign = "right";
        ctx.fillText(`${Math.round(v)}K`, padding.left - 6, y + 3);
      }

      // Emergency Shutdown Threshold Line (440 K)
      if (tripTemp >= tMin && tripTemp <= tMax) {
        const tripY = mapTempToY(tripTemp);
        ctx.setLineDash([4, 4]);
        ctx.strokeStyle = "#ff5548";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(padding.left, tripY);
        ctx.lineTo(padding.left + plotW, tripY);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // 4. Draw Trajectory Trail
      const count = filled.current;
      if (count > 1) {
        const startIdx = writeIndex.current - count;

        ctx.lineWidth = 1.8;
        for (let i = 1; i < count; i++) {
          const idxPrev = (startIdx + i - 1 + trailLength * 2) % trailLength;
          const idxCurr = (startIdx + i + trailLength * 2) % trailLength;
          
          const x1 = mapCaToX(caTrail.current[idxPrev]);
          const y1 = mapTempToY(tTrail.current[idxPrev]);
          const x2 = mapCaToX(caTrail.current[idxCurr]);
          const y2 = mapTempToY(tTrail.current[idxCurr]);
          
          const alpha = i / count;
          ctx.strokeStyle = `rgba(56, 189, 248, ${alpha})`; // Cyan trail fade
          
          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
          ctx.stroke();
        }

        // Current Operating Point Dot
        const lastIdx = (writeIndex.current - 1 + trailLength * 2) % trailLength;
        const cx = mapCaToX(caTrail.current[lastIdx]);
        const cy = mapTempToY(tTrail.current[lastIdx]);
        const currentT = tTrail.current[lastIdx];

        ctx.beginPath();
        ctx.arc(cx, cy, 4, 0, Math.PI * 2);
        // Dot turns red if tripping, otherwise stays cyan
        ctx.fillStyle = currentT >= tripTemp ? "#ff5548" : "#38bdf8";
        ctx.fill();
      }

      rafRef.current = requestAnimationFrame(draw);
    };

    rafRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafRef.current);
  }, [getCa, getT, caMin, caMax, tMin, tMax, tripTemp, trailLength]);

  return (
    <div style={{ width: "100%" }}>
      <canvas
        ref={canvasRef}
        style={{
          width: "100%",
          height: 180, 
          display: "block",
          borderRadius: 8,
          background: "#0a0d13",
          border: "1px solid #1f2733",
        }}
      />
    </div>
  );
}