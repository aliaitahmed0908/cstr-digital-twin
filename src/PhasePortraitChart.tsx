import { useEffect, useRef } from "react";

interface PhasePortraitChartProps {
  getCa: () => number;
  getT: () => number;
  getTc: () => number;
  getTf: () => number;
  getF: () => number;
  getV: () => number;
  caMin?: number;
  caMax?: number;
  tMin?: number;
  tMax?: number;
  tripTemp?: number;
}

export function PhasePortraitChart({
  getCa,
  getT,
  getTc,
  getTf,
  getF,
  getV,
  caMin = 0,
  caMax = 1.0,
  tMin = 260,
  tMax = 460,
  tripTemp = 440,
}: PhasePortraitChartProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animId: number;

    const render = () => {
      const width = canvas.width;
      const height = canvas.height;
      
      ctx.clearRect(0, 0, width, height);

      // Background grid
      ctx.strokeStyle = "#1f2733";
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = 0; x < width; x += 40) {
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
      }
      for (let y = 0; y < height; y += 30) {
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
      }
      ctx.stroke();

      const currentCa = getCa();
      const currentT = getT();
      const tc = getTc();
      const tf = getTf();
      const F = getF();
      const V = getV();

      const toX = (ca: number) => ((ca - caMin) / (caMax - caMin)) * width;
      const toY = (t: number) => height - ((t - tMin) / (tMax - tMin)) * height;

      const Caf = 1.0;
      const rho = 1000.0;
      const Cp = 4.18;
      const R = 8.314;
      const k0 = 7.2e10;
      const Ea = 72750.0;
      const dHr = -50000.0;
      const UA = 50000.0;
      const rhoCp = rho * Cp;
      const dilution = Math.max(1e-4, F / Math.max(1.0, V));

      // 1. Draw Ca Nullcline (dCa/dt = 0) -> Purple curve
      ctx.strokeStyle = "#a78bfa";
      ctx.lineWidth = 2;
      ctx.beginPath();
      let firstCa = true;
      for (let px = 0; px <= width; px += 2) {
        const ca = caMin + (px / width) * (caMax - caMin);
        if (ca <= 0 || ca >= Caf) continue;

        const k1 = (dilution * (Caf - ca)) / ca;
        if (k1 > 0 && k1 < k0) {
          const logVal = Math.log(k1 / k0);
          if (Number.isFinite(logVal) && logVal !== 0) {
            const T = -Ea / (R * logVal);
            if (Number.isFinite(T) && T >= tMin && T <= tMax) {
              const py = toY(T);
              if (Number.isFinite(py)) {
                if (firstCa) {
                  ctx.moveTo(px, py);
                  firstCa = false;
                } else {
                  ctx.lineTo(px, py);
                }
              }
            }
          }
        }
      }
      ctx.stroke();

      // 2. Draw T Nullcline (dT/dt = 0) -> Smooth Orange curve via explicit Ca(T) evaluation
      ctx.strokeStyle = "#ffb545";
      ctx.lineWidth = 2;
      ctx.beginPath();
      let firstT = true;
      
      for (let T_test = tMin; T_test <= tMax; T_test += 0.5) {
        const expTerm = Math.exp(-Ea / (R * T_test));
        if (!Number.isFinite(expTerm)) continue;

        const k1 = k0 * expTerm;
        const heatRem = dilution * (T_test - tf) + (UA / (rhoCp * Math.max(1.0, V))) * (T_test - tc);
        const heatGenCoeff = (Math.abs(dHr) / rhoCp) * k1;

        if (heatGenCoeff > 1e-6) {
          const ca = heatRem / heatGenCoeff;
          if (Number.isFinite(ca) && ca >= caMin && ca <= caMax) {
            const px = toX(ca);
            const py = toY(T_test);
            if (Number.isFinite(px) && Number.isFinite(py)) {
              if (firstT) {
                ctx.moveTo(px, py);
                firstT = false;
              } else {
                ctx.lineTo(px, py);
              }
            }
          }
        }
      }
      ctx.stroke();

      // 3. Draw current state operating point dot
      if (Number.isFinite(currentCa) && Number.isFinite(currentT)) {
        const dotX = toX(currentCa);
        const dotY = toY(currentT);
        if (Number.isFinite(dotX) && Number.isFinite(dotY)) {
          ctx.fillStyle = currentT >= tripTemp ? "#ff5548" : "#34d399";
          ctx.beginPath();
          ctx.arc(dotX, dotY, 6, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = "#ffffff";
          ctx.lineWidth = 2;
          ctx.stroke();
        }
      }

      animId = requestAnimationFrame(render);
    };

    animId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(animId);
  }, [getCa, getT, getTc, getTf, getF, getV, caMin, caMax, tMin, tMax, tripTemp]);

  return (
    <div style={{ position: "relative", width: "100%", height: 180, background: "#06090f", borderRadius: 8, overflow: "hidden", border: "1px solid #1f2733" }}>
      <canvas ref={canvasRef} width={340} height={180} style={{ width: "100%", height: "100%", display: "block" }} />
      <div style={{ position: "absolute", bottom: 6, left: 8, display: "flex", gap: 12, fontSize: 10, color: "#8a94a6" }}>
        <span style={{ color: "#a78bfa" }}>— $dC_A/dt = 0$</span>
        <span style={{ color: "#ffb545" }}>— $dT/dt = 0$</span>
      </div>
    </div>
  );
}