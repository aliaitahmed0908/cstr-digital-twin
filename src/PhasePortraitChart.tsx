import { useEffect, useRef } from "react";
import { defaultParams } from "./simulation";

interface PhasePortraitChartProps {
  getCa: () => number;
  getT: () => number;
  getTc?: () => number;
  getTf?: () => number;
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
  getTc,
  getTf,
  caMin = 0,
  caMax = 1.0,
  tMin = 260,
  tMax = 460,
  tripTemp = 440,
  trailLength = 150,
}: PhasePortraitChartProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  const caTrail = useRef<Float64Array>(new Float64Array(trailLength));
  const tTrail = useRef<Float64Array>(new Float64Array(trailLength));
  const writeIndex = useRef(0);
  const filled = useRef(0);
  const lastSampleTime = useRef(0);
  const rafRef = useRef<number>(0);

  // ISOLATE GETTERS FROM REACT RENDER CYCLE
  const getters = useRef({ getCa, getT, getTc, getTf });
  useEffect(() => {
    getters.current = { getCa, getT, getTc, getTf };
  }, [getCa, getT, getTc, getTf]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const sampleIntervalMs = 100;

    const draw = (now: number) => {
      const { getCa, getT, getTc, getTf } = getters.current;

      // Data Sampling
      if (now - lastSampleTime.current >= sampleIntervalMs) {
        lastSampleTime.current = now;
        const idx = writeIndex.current % trailLength;
        caTrail.current[idx] = getCa();
        tTrail.current[idx] = getT();
        writeIndex.current++;
        filled.current = Math.min(filled.current + 1, trailLength);
      }

      // High-DPI Canvas Setup
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      const w = rect.width || 300;
      const h = rect.height || 180;
      if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
        canvas.width = w * dpr;
        canvas.height = h * dpr;
      }
      
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      // Layout Padding
      const padding = { top: 20, right: 15, bottom: 30, left: 45 };
      const plotW = w - padding.left - padding.right;
      const plotH = h - padding.top - padding.bottom;

      const mapCaToX = (val: number) =>
        padding.left + ((val - caMin) / (caMax - caMin)) * plotW;
      const mapTempToY = (val: number) =>
        padding.top + plotH - ((val - tMin) / (tMax - tMin)) * plotH;

      ctx.fillStyle = "#0a0d13";
      ctx.fillRect(0, 0, w, h);

      // CLIPPING MASK FOR DATA CURVES
      ctx.save();
      ctx.beginPath();
      ctx.rect(padding.left, padding.top, plotW, plotH);
      ctx.clip();

      // THEORETICAL NULLCLINES (Strictly Typed)
      const currentTc = getTc ? getTc() : 300;
      const currentTf = getTf ? getTf() : (defaultParams.Tf ?? 350);
      
      const F = defaultParams.F ?? 100;
      const V = defaultParams.V ?? 100;
      const Caf = defaultParams.Caf ?? 1.0;
      const R = defaultParams.R ?? 8.314;
      const rho = defaultParams.rho ?? 1000;
      const Cp = defaultParams.Cp ?? 4.18;
      const rhoCp = rho * Cp;
      const k0 = defaultParams.k0 ?? 7.2e10;
      const Ea = defaultParams.Ea ?? 72750;
      const dHr = defaultParams.dHr ?? -50000;
      const UA = defaultParams.UA ?? 50000;
      const tau = V / F;

      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 4]);

      // A. Concentration Nullcline (Purple)
      ctx.beginPath();
      ctx.strokeStyle = "rgba(167, 139, 250, 0.7)"; 
      for (let T = tMin - 10; T <= tMax + 10; T += 2) {
        const k1 = k0 * Math.exp(-Ea / (R * T));
        const Ca_null = Caf / (1 + k1 * tau);
        const x = mapCaToX(Ca_null);
        const y = mapTempToY(T);
        if (T === tMin - 10) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();

      // B. Thermal Nullcline (Orange)
      ctx.beginPath();
      ctx.strokeStyle = "rgba(251, 146, 60, 0.7)";
      for (let T = tMin - 10; T <= tMax + 10; T += 2) {
        const k1 = k0 * Math.exp(-Ea / (R * T));
        let heatGenFactor = (Math.abs(dHr) / rhoCp) * k1;
        
        if (defaultParams.k02 !== undefined && defaultParams.Ea2 !== undefined) {
          const k2 = defaultParams.k02 * Math.exp(-defaultParams.Ea2 / (R * T));
          const dHr2 = defaultParams.dHr2 ?? -20000;
          heatGenFactor += (Math.abs(dHr2) / rhoCp) * k2 * (k1 / (1 / tau + k2));
        }
        
        const heatRemoval = (T - currentTf) / tau + (UA / (rhoCp * V)) * (T - currentTc);
        
        if (heatGenFactor > 1e-10) {
          const Ca_null = heatRemoval / heatGenFactor;
          const x = mapCaToX(Ca_null);
          const y = mapTempToY(T);
          if (T === tMin - 10) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
      }
      ctx.stroke();
      ctx.setLineDash([]);
      
      // LIVE TRAJECTORY TRAIL
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
          ctx.strokeStyle = `rgba(56, 189, 248, ${alpha})`;
          
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
        ctx.fillStyle = (tripTemp !== undefined && currentT >= tripTemp) ? "#ff5548" : "#38bdf8";
        ctx.fill();
      }

      ctx.restore(); // Remove clipping mask

      // Grid Lines & Axes Overlays
      ctx.strokeStyle = "#1f2733";
      ctx.lineWidth = 1;
      ctx.fillStyle = "#5b6577";
      ctx.font = "10px monospace";

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

      if (tripTemp !== undefined && tripTemp >= tMin && tripTemp <= tMax) {
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

      // Legend
      ctx.textAlign = "right";
      ctx.fillStyle = "rgba(167, 139, 250, 0.9)";
      ctx.fillText("dCa/dt = 0", padding.left + plotW - 5, padding.top + 5);
      ctx.fillStyle = "rgba(251, 146, 60, 0.9)";
      ctx.fillText("dT/dt = 0", padding.left + plotW - 5, padding.top + 18);

      rafRef.current = requestAnimationFrame(draw);
    };

    rafRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafRef.current);
  }, [caMin, caMax, tMin, tMax, tripTemp, trailLength]);

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