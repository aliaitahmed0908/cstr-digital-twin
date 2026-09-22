import { useEffect, useRef } from "react";
import type { EnergyTerms } from "./simulation";

interface EnergyBalanceChartProps {
  getTerms: () => EnergyTerms;
  windowSeconds?: number;
  height?: number;
}

const SERIES = [
  { key: "feed" as const, label: "Feed", color: "#3ba8ff" },
  { key: "mainRxn" as const, label: "Main Rxn", color: "#34d399" },
  { key: "sideRxn" as const, label: "Side Rxn", color: "#ff8a5c" },
  { key: "cooling" as const, label: "Cooling", color: "#a78bfa" },
];

export function EnergyBalanceChart({ getTerms, windowSeconds = 30, height = 130 }: EnergyBalanceChartProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);
  const historyRef = useRef<{ t: number; terms: EnergyTerms }[]>([]);
  const startRef = useRef<number>(performance.now());

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const draw = () => {
      const now = performance.now();
      const tSec = (now - startRef.current) / 1000;
      const terms = getTerms();
      historyRef.current.push({ t: tSec, terms });
      const cutoff = tSec - windowSeconds;
      while (historyRef.current.length > 1 && historyRef.current[0].t < cutoff) {
        historyRef.current.shift();
      }

      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
        canvas.width = w * dpr;
        canvas.height = h * dpr;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      const hist = historyRef.current;
      if (hist.length < 2) {
        rafRef.current = requestAnimationFrame(draw);
        return;
      }

      let maxAbs = 1;
      for (const pt of hist) {
        for (const s of SERIES) {
          maxAbs = Math.max(maxAbs, Math.abs(pt.terms[s.key]));
        }
      }
      maxAbs *= 1.15;

      const tMin = hist[0].t;
      const tMax = hist[hist.length - 1].t;
      const tSpan = Math.max(0.001, tMax - tMin);
      const xOf = (t: number) => ((t - tMin) / tSpan) * w;
      const yOf = (v: number) => h / 2 - (v / maxAbs) * (h / 2 - 6);

      // Zero line
      ctx.strokeStyle = "#232c3a";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, h / 2);
      ctx.lineTo(w, h / 2);
      ctx.stroke();

      for (const s of SERIES) {
        ctx.strokeStyle = s.color;
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        hist.forEach((pt, i) => {
          const x = xOf(pt.t);
          const y = yOf(pt.terms[s.key]);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        ctx.stroke();
      }

      rafRef.current = requestAnimationFrame(draw);
    };

    rafRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [windowSeconds]);

  return (
    <div>
      <canvas ref={canvasRef} style={{ width: "100%", height, display: "block" }} />
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 6 }}>
        {SERIES.map((s) => (
          <div key={s.key} style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: s.color, display: "inline-block" }} />
            <span style={{ fontSize: 10, color: "#8a94a6" }}>{s.label}</span>
          </div>
        ))}
      </div>
      <div style={{ fontSize: 9.5, color: "#5b6577", marginTop: 4 }}>
        K/min · positive = heating, negative = cooling
      </div>
    </div>
  );
}