import { useEffect, useRef, useState } from "react";

interface ReactionPathwayProps {
  getCa: () => number;
  getCb: () => number;
  getCaf: () => number;
  getRate1: () => number;
  getRate2: () => number;
  /** Rates at/above this are treated as "fully on" for the visual scaling
   *  of arrow thickness and flow-dash animation speed. */
  maxRate?: number;
}

const NODE_COLORS = { A: "#3ba8ff", B: "#34d399", C: "#ff8a5c" };

export function ReactionPathway({
  getCa,
  getCb,
  getCaf,
  getRate1,
  getRate2,
  maxRate = 30,
}: ReactionPathwayProps) {
  const [tick, setTick] = useState(0);
  const rafRef = useRef<number>(0);
  const dashOffsetRef = useRef(0);
  const valuesRef = useRef({ Ca: 0.5, Cb: 0, Cc: 0, rate1: 0, rate2: 0 });

  useEffect(() => {
    const loop = () => {
      const Ca = getCa();
      const Cb = getCb();
      const Caf = getCaf();
      const Cc = Math.max(0, Caf - Ca - Cb);
      const rate1 = getRate1();
      const rate2 = getRate2();
      valuesRef.current = { Ca, Cb, Cc, rate1, rate2 };
      const speed = 0.4 + 3 * Math.min(1, (rate1 + rate2) / (maxRate * 2));
      dashOffsetRef.current -= speed;
      setTick((t) => (t + 1) % 1000000);
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { Ca, Cb, Cc, rate1, rate2 } = valuesRef.current;
  const norm1 = Math.max(0.06, Math.min(1, rate1 / maxRate));
  const norm2 = Math.max(0.06, Math.min(1, rate2 / maxRate));

  void tick; // force re-render each frame

  return (
    <div>
      <svg viewBox="0 0 340 110" width="100%" height="110" style={{ overflow: "visible" }}>
        <defs>
          <marker id="arrowhead" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto">
            <path d="M0,0 L8,4 L0,8 Z" fill="#5b6577" />
          </marker>
        </defs>

        {/* A -> B arrow */}
        <line
          x1="55" y1="55" x2="155" y2="55"
          stroke={NODE_COLORS.B}
          strokeWidth={1.5 + norm1 * 5}
          strokeDasharray="6 5"
          strokeDashoffset={dashOffsetRef.current}
          markerEnd="url(#arrowhead)"
          opacity={0.85}
        />
        <text x="105" y="42" textAnchor="middle" fontSize="9" fill="#8a94a6" className="mono">
          k₁ = {rate1.toFixed(2)}/min
        </text>

        {/* B -> C arrow */}
        <line
          x1="185" y1="55" x2="285" y2="55"
          stroke={NODE_COLORS.C}
          strokeWidth={1.5 + norm2 * 5}
          strokeDasharray="6 5"
          strokeDashoffset={dashOffsetRef.current}
          markerEnd="url(#arrowhead)"
          opacity={0.85}
        />
        <text x="235" y="42" textAnchor="middle" fontSize="9" fill="#8a94a6" className="mono">
          k₂ = {rate2.toFixed(2)}/min
        </text>

        {/* Node A */}
        <circle cx="30" cy="55" r="26" fill="#0f1420" stroke={NODE_COLORS.A} strokeWidth="2" />
        <text x="30" y="52" textAnchor="middle" fontSize="15" fontWeight={700} fill={NODE_COLORS.A}>A</text>
        <text x="30" y="66" textAnchor="middle" fontSize="8" fill="#c3cad6" className="mono">{Ca.toFixed(3)}</text>

        {/* Node B (desired product) */}
        <circle cx="170" cy="55" r="26" fill="#0f1420" stroke={NODE_COLORS.B} strokeWidth="2" />
        <text x="170" y="52" textAnchor="middle" fontSize="15" fontWeight={700} fill={NODE_COLORS.B}>B</text>
        <text x="170" y="66" textAnchor="middle" fontSize="8" fill="#c3cad6" className="mono">{Cb.toFixed(3)}</text>

        {/* Node C (byproduct) */}
        <circle cx="310" cy="55" r="26" fill="#0f1420" stroke={NODE_COLORS.C} strokeWidth="2" />
        <text x="310" y="52" textAnchor="middle" fontSize="15" fontWeight={700} fill={NODE_COLORS.C}>C</text>
        <text x="310" y="66" textAnchor="middle" fontSize="8" fill="#c3cad6" className="mono">{Cc.toFixed(3)}</text>
      </svg>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9.5, color: "#5b6577", marginTop: 2 }}>
        <span>Reactant</span>
        <span>Desired product</span>
        <span>Byproduct</span>
      </div>
    </div>
  );
}