import { useEffect, useRef, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, Environment, ContactShadows, Grid } from "@react-three/drei";
import {
  CSTREngine,
  defaultParams,
  PIController,
  SENSITIVITY_KEYS,
  type SensitivityKey,
  type EnergyTerms,
  type ReactionRates,
} from "./simulation";
import { ReactorMesh } from "./ReactorMesh";
import { TelemetryChart } from "./TelemetryChart";
import { PhasePortraitChart } from "./PhasePortraitChart";
import { ReactionPathway } from "./ReactionPathway";
import { EnergyBalanceChart } from "./EnergyBalanceChart";

type PresetKey = "cold" | "runaway" | "rejection";

const SENSITIVITY_LABELS: Record<SensitivityKey, string> = {
  Ea: "Activation Energy (Ea)",
  k0: "Pre-exponential Factor (k0)",
  UA: "Heat Transfer Coeff. (UA)",
  dHr: "Heat of Reaction (dHr)",
};

export default function App() {
  const engineRef = useRef<CSTREngine>(new CSTREngine(0.5, 350, defaultParams));
  
  // Controllers for Cascade Architecture
  const masterControllerRef = useRef<PIController>(new PIController(2.0, 0.6, 250, 450));
  const slaveControllerRef = useRef<PIController>(new PIController(5.0, 0.2, 250, 450));
  
  const rafRef = useRef<number>(0);
  const lastTimeRef = useRef<number>(performance.now());
  const presetTimeoutsRef = useRef<number[]>([]);

  const [telemetry, setTelemetry] = useState({ Ca: 0.5, Cb: 0, T: 350, simTime: 0 });
  const [recordStats, setRecordStats] = useState({ count: 0, duration: 0 });
  const [tc, setTc] = useState(defaultParams.Tc);
  
  // Control State & IAE Metrics
  const [kp, setKp] = useState(2.0);
  const [tauI, setTauI] = useState(0.6);
  const [slaveKp, setSlaveKp] = useState(5.0);
  const [slaveTauI, setSlaveTauI] = useState(0.2);
  const [iae, setIae] = useState(0);

  // Design Parameters
  const [volume, setVolume] = useState(defaultParams.V);
  const [flowRate, setFlowRate] = useState(defaultParams.F);

  // Disturbances & Faults
  const [tfDisturbance, setTfDisturbance] = useState(false);
  const [flowDisturbance, setFlowDisturbance] = useState(false);
  const [uaFault, setUaFault] = useState(false);
  const [agitatorFault, setAgitatorFault] = useState(false);
  const [cafFault, setCafFault] = useState(false);

  const [autoMode, setAutoMode] = useState(false);
  const [cascadeMode, setCascadeMode] = useState(false);
  const [setpoint, setSetpoint] = useState(330);
  const [activePreset, setActivePreset] = useState<PresetKey | null>(null);
  const [cutawayOn, setCutawayOn] = useState(false);
  const [esdActive, setEsdActive] = useState(false);
  const [esdResetPermitted, setEsdResetPermitted] = useState(false);
  const [faulted, setFaulted] = useState(false);
  const [sensitivityKey, setSensitivityKey] = useState<SensitivityKey | null>(null);
  const [sensitivityPct, setSensitivityPct] = useState(0);

  const liveTempRef = useRef(350);
  const liveCaRef = useRef(0.5);
  const liveCbRef = useRef(0);
  const jacketTcRef = useRef(300);
  const iaeRef = useRef(0);
  
  const energyTermsRef = useRef<EnergyTerms>({ feed: 0, mainRxn: 0, sideRxn: 0, cooling: 0 });
  const ratesRef = useRef<ReactionRates>({ rate1: 0, rate2: 0 });
  
  const autoModeRef = useRef(autoMode);
  const cascadeModeRef = useRef(cascadeMode);
  const setpointRef = useRef(setpoint);

  useEffect(() => {
    autoModeRef.current = autoMode;
    if (autoMode) {
      masterControllerRef.current.reset();
      slaveControllerRef.current.reset();
    }
  }, [autoMode]);

  useEffect(() => {
    cascadeModeRef.current = cascadeMode;
    if (cascadeMode) slaveControllerRef.current.reset();
  }, [cascadeMode]);

  useEffect(() => {
    setpointRef.current = setpoint;
  }, [setpoint]);

  useEffect(() => {
    masterControllerRef.current.setTunings(kp, tauI);
  }, [kp, tauI]);

  useEffect(() => {
    slaveControllerRef.current.setTunings(slaveKp, slaveTauI);
  }, [slaveKp, slaveTauI]);

  // FIXED: Properly clear integral windup so it doesn't instantly jump
  const resetIae = (e?: React.MouseEvent) => {
    if (e) e.preventDefault();
    iaeRef.current = 0;
    setIae(0);
    masterControllerRef.current.reset();
    slaveControllerRef.current.reset();
  };

  useEffect(() => {
    const engine = engineRef.current;

    if (engine.getHistory().length === 0) {
      engine.resetState(0.5, 350); 
    }

    const loop = (now: number) => {
      const dtSeconds = Math.min((now - lastTimeRef.current) / 1000, 0.1);
      lastTimeRef.current = now;
      const simMinutesPerSecond = 0.5;
      const dtMinutes = dtSeconds * simMinutesPerSecond;

      if (autoModeRef.current && !engine.isEsdTripped()) {
        const { T } = engine.getState();
        
        // 1. Master PI Controller
        const masterOutputTcSp = masterControllerRef.current.compute(setpointRef.current, T, dtMinutes);
        let commandedTc = masterOutputTcSp;
        
        // 2. Slave PI Controller
        if (cascadeModeRef.current) {
          commandedTc = slaveControllerRef.current.compute(masterOutputTcSp, jacketTcRef.current, dtMinutes);
        }
        
        // 3. Simulated Jacket Thermal Lag
        const jacketTau = 0.15;
        jacketTcRef.current += (commandedTc - jacketTcRef.current) * (dtMinutes / jacketTau);
        
        engine.setTc(jacketTcRef.current);
        setTc(jacketTcRef.current);
        
        // 4. Update IAE
        iaeRef.current += Math.abs(setpointRef.current - T) * dtMinutes;
        setIae(iaeRef.current);
      } else {
        jacketTcRef.current = engine.getState().T; 
      }

      engine.advanceRealTime(dtSeconds, simMinutesPerSecond, 20);
      const { Ca, Cb, T } = engine.getState();
      
      liveTempRef.current = T;
      liveCaRef.current = Ca;
      liveCbRef.current = Cb;
      energyTermsRef.current = engine.getEnergyTerms();
      ratesRef.current = engine.getRates();
      
      const history = engine.getHistory();
      setRecordStats({
        count: history.length,
        duration: history.length > 0 ? history[history.length - 1].time_min : 0
      });

      setTelemetry({ Ca, Cb, T, simTime: engine.getTime() });
      setEsdActive(engine.isEsdTripped());
      setEsdResetPermitted(engine.isEsdResetPermitted());
      setFaulted(engine.isFaulted());
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  const clearPresetTimeouts = () => {
    presetTimeoutsRef.current.forEach((id) => window.clearTimeout(id));
    presetTimeoutsRef.current = [];
  };

  useEffect(() => {
    return () => clearPresetTimeouts();
  }, []);

  const handleTcChange = (value: number) => {
    setTc(value);
    engineRef.current.setTc(value);
    jacketTcRef.current = value;
  };

  const handleVolumeChange = (v: number) => {
    setVolume(v);
    engineRef.current.setDesignParam("V", v);
  };

  const handleFlowRateChange = (f: number) => {
    setFlowRate(f);
    engineRef.current.setDesignParam("F", f);
  };

  const toggleTfDisturbance = () => {
    const next = !tfDisturbance;
    setTfDisturbance(next);
    engineRef.current.setDisturbance("Tf", next);
  };

  const toggleFlowDisturbance = () => {
    const next = !flowDisturbance;
    setFlowDisturbance(next);
    engineRef.current.setDisturbance("F", next);
  };

  const toggleUaFault = () => {
    const next = !uaFault;
    setUaFault(next);
    engineRef.current.setFault("ua", next);
  };

  const toggleAgitatorFault = () => {
    const next = !agitatorFault;
    setAgitatorFault(next);
    engineRef.current.setFault("agitator", next);
  };

  const toggleCafFault = () => {
    const next = !cafFault;
    setCafFault(next);
    engineRef.current.setFault("caf", next);
  };

  const stopPreset = () => {
    clearPresetTimeouts();
    setActivePreset(null);
  };

  const resetEngineToSafeState = () => {
    clearPresetTimeouts();
    setActivePreset(null);
    setAutoMode(false);
    setTfDisturbance(false);
    setFlowDisturbance(false);
    setUaFault(false);
    setAgitatorFault(false);
    setCafFault(false);
    engineRef.current.setDisturbance("Tf", false);
    engineRef.current.setDisturbance("F", false);
    engineRef.current.setFault("ua", false);
    engineRef.current.setFault("agitator", false);
    engineRef.current.setFault("caf", false);
    engineRef.current.resetState(0.5, 350);
    engineRef.current.setTc(300);
    setTc(300);
    jacketTcRef.current = 300;
    setFaulted(false);
    setEsdActive(false);
    resetIae();
  };

  const handleAcknowledgeEsd = () => {
    const cleared = engineRef.current.acknowledgeEsd();
    if (cleared) {
      setAutoMode(false);
      engineRef.current.setTc(300);
      setTc(300);
      jacketTcRef.current = 300;
      setEsdActive(false);
    }
  };

  const applySensitivity = (key: SensitivityKey | null, pct: number) => {
    engineRef.current.resetSensitivityParams();
    if (key) {
      const base = defaultParams[key];
      engineRef.current.setSensitivityParam(key, base * (1 + pct / 100));
    }
  };

  const handleSensitivityKeyChange = (value: string) => {
    const key = value === "none" ? null : (value as SensitivityKey);
    setSensitivityKey(key);
    setSensitivityPct(0);
    applySensitivity(key, 0);
  };

  const handleSensitivityPctChange = (pct: number) => {
    setSensitivityPct(pct);
    applySensitivity(sensitivityKey, pct);
  };

  const handleSensitivityReset = () => {
    setSensitivityKey(null);
    setSensitivityPct(0);
    engineRef.current.resetSensitivityParams();
  };

  const handlePresetToggle = (key: PresetKey) => {
    if (activePreset === key) {
      stopPreset();
      return;
    }
    clearPresetTimeouts();
    setActivePreset(key);
    setFaulted(false);
    resetIae();

    if (key === "cold") {
      setAutoMode(false);
      setTfDisturbance(false);
      setFlowDisturbance(false);
      setUaFault(false);
      setAgitatorFault(false);
      setCafFault(false);
      engineRef.current.setDisturbance("Tf", false);
      engineRef.current.setDisturbance("F", false);
      engineRef.current.setFault("ua", false);
      engineRef.current.setFault("agitator", false);
      engineRef.current.setFault("caf", false);
      engineRef.current.resetState(1.0, 300);
      engineRef.current.setTc(300);
      setTc(300);
      jacketTcRef.current = 300;
    }

    if (key === "runaway") {
      setAutoMode(false);
      setTfDisturbance(false);
      setFlowDisturbance(false);
      setUaFault(false);
      setAgitatorFault(false);
      setCafFault(false);
      engineRef.current.setDisturbance("Tf", false);
      engineRef.current.setDisturbance("F", false);
      engineRef.current.setFault("ua", false);
      engineRef.current.setFault("agitator", false);
      engineRef.current.setFault("caf", false);
      engineRef.current.resetState(0.5, 350);
      engineRef.current.setTc(420);
      setTc(420);
      jacketTcRef.current = 420;
    }

    if (key === "rejection") {
      setTfDisturbance(false);
      setFlowDisturbance(false);
      setUaFault(false);
      setAgitatorFault(false);
      setCafFault(false);
      engineRef.current.setDisturbance("Tf", false);
      engineRef.current.setDisturbance("F", false);
      engineRef.current.setFault("ua", false);
      engineRef.current.setFault("agitator", false);
      engineRef.current.setFault("caf", false);
      engineRef.current.resetState(0.5, 330);
      setSetpoint(330);
      setAutoMode(true);

      const id = window.setTimeout(() => {
        setTfDisturbance(true);
        engineRef.current.setDisturbance("Tf", true);
      }, 4000);
      presetTimeoutsRef.current.push(id);
    }
  };

  const escapeCSV = (val: string | number | boolean) => {
    const str = String(val);
    if (str.includes(",") || str.includes('"') || str.includes("\n")) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const handleExportCSV = () => {
    const history = engineRef.current.getHistory();
    if (history.length === 0) return;

    const headers = [
      "time_min", "temperature_K", "CA_mol_per_L", "CB_mol_per_L",
      "coolant_temperature_K", "Qcool_J_per_min", "conversion_pct",
      "selectivity_B_pct", "esd_latched", "scenario_preset", "auto_control_active"
    ];

    const currentScenario = activePreset || "manual";

    const rows = history.map(r => [
      r.time_min,
      r.temperature_K,
      r.CA_mol_per_L,
      r.CB_mol_per_L,
      r.coolant_temperature_K,
      r.Qcool_J_per_min,
      r.conversion_pct,
      r.selectivity_B_pct,
      r.esd_latched,
      escapeCSV(currentScenario),
      autoMode
    ].join(","));

    const csvContent = [headers.join(","), ...rows].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    
    const link = document.createElement("a");
    link.href = url;
    
    const dateStr = new Date().toISOString().replace(/[:.]/g, "-");
    link.setAttribute("download", `cstr-${currentScenario}-${dateStr}.csv`);
    
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleExportMarkdownReport = () => {
    const conversion = (1 - telemetry.Ca / defaultParams.Caf) * 100;
    const reportStr = `
# CSTR Digital Twin - Engineering Report
*Generated via React Process Simulation*

## 1. Physical Design & Kinetic Parameters
*   **Reactor Volume (V):** ${volume.toFixed(1)} L
*   **Feed Flow Rate (F):** ${flowRate.toFixed(1)} L/min
*   **Residence Time (tau):** ${(volume / flowRate).toFixed(2)} min
*   **Heat Transfer Coeff (UA):** ${defaultParams.UA.toExponential(2)} J/min·K

## 2. Advanced Process Control (APC) Configuration
*   **Control Strategy:** ${autoMode ? (cascadeMode ? "Cascade (Master-Slave PI)" : "Standard Single-Loop PI") : "Manual Open-Loop"}
*   **Target Setpoint (T):** ${setpoint.toFixed(1)} K
*   **Master PI Tuning:** Kp = ${kp.toFixed(2)}, tau_i = ${tauI.toFixed(2)} min
${cascadeMode ? `*   **Slave PI Tuning:** Kp = ${slaveKp.toFixed(2)}, tau_i = ${slaveTauI.toFixed(2)} min` : ""}

## 3. Real-Time Telemetry & Disturbance State
*   **Operating Point:** C_A = ${telemetry.Ca.toFixed(3)} mol/L, T = ${telemetry.T.toFixed(1)} K
*   **Coolant Jacket Temp (Tc):** ${tc.toFixed(1)} K
*   **Reaction Conversion:** ${conversion.toFixed(1)}%
*   **Integral Absolute Error (IAE):** ${iae.toFixed(2)}
*   **Active Disturbances:** ${tfDisturbance ? "Feed Temp (+40K)" : "None"} | ${flowDisturbance ? "Feed Flow Surge" : "None"}

## 4. Phase Space & Stability Notes
*This section allows for theoretical inclusion of bifurcation nullcline figures tracking dCa/dt = 0 and dT/dt = 0 intersections.*
    `.trim();

    const blob = new Blob([reportStr], { type: "text/markdown;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `CSTR_Technical_Appendix_${new Date().getTime()}.md`;
    link.click();
  };

  const anyDisturbanceActive = tfDisturbance || flowDisturbance || uaFault || agitatorFault || cafFault;

  const thermalState =
    telemetry.T > 400 ? "RUNAWAY RISK" : telemetry.T > 370 ? "ELEVATED" : "NOMINAL";

  const stateColor =
    thermalState === "RUNAWAY RISK" ? "#ff5548" : thermalState === "ELEVATED" ? "#ffb545" : "#34d399";

  const conversion = (1 - telemetry.Ca / defaultParams.Caf) * 100;
  const totalConverted = defaultParams.Caf - telemetry.Ca;
  const selectivity = totalConverted > 1e-6 ? (telemetry.Cb / totalConverted) * 100 : 100;

  const controlsLocked = esdActive || faulted;

  return (
    <div style={{ height: "100vh", width: "100vw", display: "flex", flexDirection: "column" }}>
      <header
        style={{
          height: 56,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 24px",
          borderBottom: "1px solid #1f2733",
          background: "linear-gradient(180deg, #0d1119 0%, #0b0e14 100%)",
          flexShrink: 0,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div
            style={{
              width: 10,
              height: 10,
              borderRadius: 3,
              background: `linear-gradient(135deg, ${stateColor}, #3b82f6)`,
            }}
          />
          <span style={{ fontWeight: 700, fontSize: 15, letterSpacing: 0.2 }}>
            CSTR Digital Twin
          </span>
          <span style={{ fontSize: 11, color: "#5b6577", marginLeft: 6 }}>
            v1.0 · RK4 non-isothermal reactor
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          {faulted && (
            <div style={{ display: "flex", alignItems: "center", fontSize: 11.5, color: "#ff5548", fontWeight: 700 }}>
              <span className="status-dot" style={{ background: "#ff5548" }} />
              NUMERICAL FAULT
            </div>
          )}
          {esdActive && !faulted && (
            <div style={{ display: "flex", alignItems: "center", fontSize: 11.5, color: "#ff5548", fontWeight: 700 }}>
              <span className="status-dot" style={{ background: "#ff5548" }} />
              ESD LATCHED
            </div>
          )}
          {autoMode && !esdActive && !faulted && (
            <div style={{ display: "flex", alignItems: "center", fontSize: 11.5, color: "#a78bfa" }}>
              <span className="status-dot" style={{ background: "#a78bfa" }} />
              {cascadeMode ? "CASCADE APC" : "AUTO CONTROL"}
            </div>
          )}
          {sensitivityKey && (
            <div style={{ display: "flex", alignItems: "center", fontSize: 11.5, color: "#3ba8ff" }}>
              <span className="status-dot" style={{ background: "#3ba8ff" }} />
              WHAT-IF: {sensitivityKey} {sensitivityPct >= 0 ? "+" : ""}{sensitivityPct}%
            </div>
          )}
          {anyDisturbanceActive && (
            <div style={{ display: "flex", alignItems: "center", fontSize: 11.5, color: "#ffb545" }}>
              <span className="status-dot" style={{ background: "#ffb545" }} />
              FAULT / DISTURBANCE ACTIVE
            </div>
          )}
          <div style={{ display: "flex", alignItems: "center", fontSize: 12.5, color: "#8a94a6" }}>
            <span className="status-dot" style={{ background: stateColor }} />
            {thermalState}
          </div>
        </div>
      </header>

      {faulted && (
        <div
          style={{
            padding: "10px 24px",
            background: "linear-gradient(90deg, #4a0f0f, #2a0808)",
            borderBottom: "1px solid #ff5548",
            color: "#ffb0a8",
            fontSize: 13,
            fontWeight: 700,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 10,
            letterSpacing: 0.3,
            flexShrink: 0,
          }}
        >
          <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 16 }}>⚠</span>
            NUMERICAL FAULT — the integrator produced a non-finite value and froze state to protect the display.
          </span>
          <button
            onClick={resetEngineToSafeState}
            style={{
              padding: "5px 12px",
              borderRadius: 6,
              border: "1px solid #ff5548",
              background: "transparent",
              color: "#ffb0a8",
              fontSize: 12,
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            Reset Reactor
          </button>
        </div>
      )}

      {esdActive && !faulted && (
        <div
          style={{
            padding: "10px 24px",
            background: "linear-gradient(90deg, #4a0f0f, #2a0808)",
            borderBottom: "1px solid #ff5548",
            color: "#ffb0a8",
            fontSize: 13,
            fontWeight: 700,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 10,
            letterSpacing: 0.3,
            flexShrink: 0,
          }}
        >
          <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 16 }}>⚠</span>
            EMERGENCY SHUTDOWN LATCHED — Tc forced to minimum (250 K).{" "}
            {esdResetPermitted
              ? "Temperature has fallen below 415 K — safe to acknowledge."
              : `Waiting for T to fall below 415 K (currently ${telemetry.T.toFixed(1)} K).`}
          </span>
          <button
            onClick={handleAcknowledgeEsd}
            disabled={!esdResetPermitted}
            style={{
              padding: "5px 12px",
              borderRadius: 6,
              border: esdResetPermitted ? "1px solid #34d399" : "1px solid #5b6577",
              background: "transparent",
              color: esdResetPermitted ? "#34d399" : "#5b6577",
              fontSize: 12,
              fontWeight: 700,
              cursor: esdResetPermitted ? "pointer" : "not-allowed",
              whiteSpace: "nowrap",
            }}
          >
            Acknowledge &amp; Resume
          </button>
        </div>
      )}

      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        <div
          style={{
            width: 380,
            padding: "18px 20px",
            borderRight: "1px solid #1f2733",
            background: "#0a0d13",
            display: "flex",
            flexDirection: "column",
            gap: 14,
            overflowY: "auto",
          }}
        >
          <Card>
            <SectionLabel>Scenario Presets</SectionLabel>
            <ToggleRow
              label="Cold Start"
              detail={activePreset === "cold" ? "Engaged · Tc = 300 K" : "Safe baseline"}
              checked={activePreset === "cold"}
              onChange={() => handlePresetToggle("cold")}
              accentColor="#3ba8ff"
            />
            <div style={{ height: 10 }} />
            <ToggleRow
              label="Runaway Demo"
              detail={activePreset === "runaway" ? "Engaged · driving toward runaway" : "Drives toward thermal runaway"}
              checked={activePreset === "runaway"}
              onChange={() => handlePresetToggle("runaway")}
              accentColor="#ff5548"
            />
            <div style={{ height: 10 }} />
            <ToggleRow
              label="Disturbance Rejection"
              detail={activePreset === "rejection" ? "Engaged · fault fires at 4s" : "Auto control + fault after 4s"}
              checked={activePreset === "rejection"}
              onChange={() => handlePresetToggle("rejection")}
              accentColor="#a78bfa"
            />
          </Card>

          <Card>
            <SectionLabel>Data Logging &amp; Report Export</SectionLabel>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
              <button
                onClick={handleExportCSV}
                disabled={recordStats.count === 0}
                style={{
                  flex: 1,
                  padding: "8px 12px",
                  borderRadius: 6,
                  border: recordStats.count > 0 ? "1px solid #3ba8ff" : "1px solid #1f2733",
                  background: recordStats.count > 0 ? "rgba(59, 168, 255, 0.1)" : "transparent",
                  color: recordStats.count > 0 ? "#3ba8ff" : "#5b6577",
                  fontSize: 11.5,
                  fontWeight: 600,
                  cursor: recordStats.count > 0 ? "pointer" : "not-allowed",
                  transition: "all 0.2s"
                }}
              >
                Export CSV Telemetry
              </button>
              <button
                onClick={handleExportMarkdownReport}
                style={{
                  flex: 1,
                  padding: "8px 12px",
                  borderRadius: 6,
                  border: "1px solid #a78bfa",
                  background: "rgba(167, 139, 250, 0.1)",
                  color: "#a78bfa",
                  fontSize: 11.5,
                  fontWeight: 600,
                  cursor: "pointer",
                  transition: "all 0.2s"
                }}
              >
                Download .MD Report
              </button>
            </div>
            <div style={{ fontSize: 10.5, color: "#5b6577", lineHeight: 1.4 }}>
              Markdown report generated is formatted for direct Overleaf/LaTeX coursework insertion.
            </div>
          </Card>

          <Card>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <div style={{ fontSize: 11, letterSpacing: 0.6, textTransform: "uppercase", color: "#5b6577", fontWeight: 600 }}>Live Telemetry</div>
              <button onClick={resetIae} style={{ fontSize: 10, padding: "4px 8px", background: "#1f2733", border: "none", color: "#a78bfa", borderRadius: 4, cursor: "pointer", zIndex: 10, position: "relative" }}>Reset IAE</button>
            </div>
            <Metric label="Concentration, Ca" value={`${telemetry.Ca.toFixed(4)} mol/L`} mono />
            <Metric label="Concentration, Cb" value={`${telemetry.Cb.toFixed(4)} mol/L`} mono />
            <Metric label="Reactor Temperature, T" value={`${telemetry.T.toFixed(2)} K`} mono />
            <Metric label="Conversion" value={`${conversion.toFixed(1)} %`} mono />
            <Metric
              label="Selectivity to B"
              value={`${selectivity.toFixed(1)} %`}
              mono
              valueColor={selectivity < 85 ? "#ffb545" : "#eef1f6"}
            />
            <Metric label="Sim Time" value={`${telemetry.simTime.toFixed(1)} min`} mono />
            <div style={{ height: 1, background: "#1f2733", margin: "10px 0" }} />
            <Metric label="Simulated Jacket Lag Tc" value={`${tc.toFixed(1)} K`} mono valueColor="#3ba8ff" />
            <Metric label="Integral Abs. Error (IAE)" value={iae.toFixed(2)} mono valueColor="#a78bfa" />
          </Card>

          <Card>
            <SectionLabel>Reactor Design Parameters (tau = V / F)</SectionLabel>
            
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
              <span style={{ fontSize: 12, color: "#8a94a6" }}>Volume (V)</span>
              <span className="mono" style={{ fontSize: 14, fontWeight: 700, color: "#3ba8ff" }}>
                {volume.toFixed(0)} L
              </span>
            </div>
            <input
              type="range"
              className="thermo-slider"
              min={20}
              max={300}
              step={5}
              value={volume}
              onChange={(e) => handleVolumeChange(parseFloat(e.target.value))}
            />

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginTop: 10, marginBottom: 4 }}>
              <span style={{ fontSize: 12, color: "#8a94a6" }}>Flow Rate (F)</span>
              <span className="mono" style={{ fontSize: 14, fontWeight: 700, color: "#3ba8ff" }}>
                {flowRate.toFixed(0)} L/min
              </span>
            </div>
            <input
              type="range"
              className="thermo-slider"
              min={20}
              max={250}
              step={5}
              value={flowRate}
              onChange={(e) => handleFlowRateChange(parseFloat(e.target.value))}
            />

            <div className="mono" style={{ fontSize: 11, color: "#a78bfa", marginTop: 10 }}>
              Residence Time (tau): {(volume / flowRate).toFixed(2)} min
            </div>
          </Card>

          <Card>
            <SectionLabel>Reaction Pathway</SectionLabel>
            <ReactionPathway
              getCa={() => liveCaRef.current}
              getCb={() => liveCbRef.current}
              getCaf={() => defaultParams.Caf}
              getRate1={() => ratesRef.current.rate1}
              getRate2={() => ratesRef.current.rate2}
            />
          </Card>

          <Card>
            <SectionLabel>Energy Balance</SectionLabel>
            <EnergyBalanceChart getTerms={() => energyTermsRef.current} windowSeconds={30} />
          </Card>

          <Card>
            <SectionLabel>Transient Response</SectionLabel>
            <TelemetryChart
              getCa={() => liveCaRef.current}
              getT={() => liveTempRef.current}
              windowSeconds={30}
              caMax={1.0}
              tMin={260}
              tMax={460}
            />
          </Card>

          <Card>
            <SectionLabel>Phase Portrait (T vs Ca)</SectionLabel>
            <PhasePortraitChart
              getCa={() => liveCaRef.current}
              getT={() => liveTempRef.current}
              getTc={() => tc}
              getTf={() => tfDisturbance ? 390.0 : 350.0}
              getF={() => flowRate}
              getV={() => volume}
              caMin={0}
              caMax={1.0}
              tMin={260}
              tMax={460}
              tripTemp={440}
            />
          </Card>

          <Card>
            <SectionLabel>Sensitivity Analysis</SectionLabel>
            <select
              value={sensitivityKey ?? "none"}
              onChange={(e) => handleSensitivityKeyChange(e.target.value)}
              style={{
                width: "100%",
                padding: "7px 8px",
                borderRadius: 6,
                background: "#0a0d13",
                border: "1px solid #1f2733",
                color: "#eef1f6",
                fontSize: 12.5,
                marginBottom: 10,
              }}
            >
              <option value="none">None (nominal parameters)</option>
              {SENSITIVITY_KEYS.map((key) => (
                <option key={key} value={key}>
                  {SENSITIVITY_LABELS[key]}
                </option>
              ))}
            </select>

            {sensitivityKey && (
              <>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
                  <span style={{ fontSize: 12.5, color: "#8a94a6" }}>Offset from nominal</span>
                  <span className="mono" style={{ fontSize: 16, fontWeight: 700, color: "#3ba8ff" }}>
                    {sensitivityPct >= 0 ? "+" : ""}{sensitivityPct}%
                  </span>
                </div>
                <input
                  type="range"
                  className="thermo-slider"
                  min={-50}
                  max={50}
                  step={1}
                  value={sensitivityPct}
                  onChange={(e) => handleSensitivityPctChange(parseFloat(e.target.value))}
                />
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#5b6577", marginTop: 6 }}>
                  <span>-50%</span>
                  <span>nominal</span>
                  <span>+50%</span>
                </div>
                <div className="mono" style={{ fontSize: 10.5, color: "#5b6577", marginTop: 8 }}>
                  {SENSITIVITY_LABELS[sensitivityKey]}: {defaultParams[sensitivityKey].toExponential(3)} → {(defaultParams[sensitivityKey] * (1 + sensitivityPct / 100)).toExponential(3)}
                </div>
                <button
                  onClick={handleSensitivityReset}
                  style={{
                    marginTop: 10,
                    padding: "5px 12px",
                    borderRadius: 6,
                    border: "1px solid #1f2733",
                    background: "transparent",
                    color: "#8a94a6",
                    fontSize: 11.5,
                    cursor: "pointer",
                  }}
                >
                  Reset to Nominal
                </button>
              </>
            )}
            {!sensitivityKey && (
              <div style={{ fontSize: 11, color: "#5b6577" }}>
                Pick a parameter to explore how the reactor responds to model uncertainty, e.g. fouling (UA↓) or catalyst deactivation (k0↓).
              </div>
            )}
          </Card>

          <Card>
            <SectionLabel>Fault Injection Sandbox</SectionLabel>
            <ToggleRow
              label="Coolant Pump Failure"
              detail={uaFault ? "UA collapsed (near 0)" : "Nominal heat transfer"}
              checked={uaFault}
              onChange={toggleUaFault}
              accentColor="#ff5548"
            />
            <div style={{ height: 10 }} />
            <ToggleRow
              label="Agitator Motor Trip"
              detail={agitatorFault ? "Mixing severely impaired" : "Normal agitation"}
              checked={agitatorFault}
              onChange={toggleAgitatorFault}
              accentColor="#ffb545"
            />
            <div style={{ height: 10 }} />
            <ToggleRow
              label="Feed Concentration Spike"
              detail={cafFault ? "Caf = 2.5 mol/L (surge)" : "Caf = 1.0 mol/L (nominal)"}
              checked={cafFault}
              onChange={toggleCafFault}
              accentColor="#3ba8ff"
            />
          </Card>

          <Card>
            <SectionLabel>Sustained Disturbances</SectionLabel>
            <ToggleRow
              label="Feed Temp Fault"
              detail={tfDisturbance ? "Tf = 390.0 K (+40)" : "Tf = 350.0 K (nominal)"}
              checked={tfDisturbance}
              onChange={toggleTfDisturbance}
              accentColor="#ff6b52"
            />
            <div style={{ height: 10 }} />
            <ToggleRow
              label="Feed Flow Fault"
              detail={flowDisturbance ? "F = 140.0 L/min (+40)" : "F = 100.0 L/min (nominal)"}
              checked={flowDisturbance}
              onChange={toggleFlowDisturbance}
              accentColor="#3ba8ff"
            />
          </Card>

          <Card>
            <SectionLabel>Temperature Control (APC)</SectionLabel>

            {controlsLocked && (
              <div
                style={{
                  fontSize: 11.5,
                  color: "#ff5548",
                  fontWeight: 700,
                  marginBottom: 12,
                  padding: "8px 10px",
                  background: "rgba(255,85,72,0.08)",
                  border: "1px solid rgba(255,85,72,0.3)",
                  borderRadius: 8,
                }}
              >
                {faulted
                  ? "Numerical fault — use Reset Reactor above to recover"
                  : "ESD latched — use Acknowledge & Resume above once T <= 415 K"}
              </div>
            )}

            <ToggleRow
              label={autoMode ? "Auto (PI Control)" : "Manual"}
              detail={autoMode ? "Controller is adjusting Tc" : "You are adjusting Tc"}
              checked={autoMode}
              onChange={() => !controlsLocked && setAutoMode((v) => !v)}
              accentColor="#a78bfa"
            />

            {autoMode && (
              <div style={{ marginTop: 14 }}>
                <ToggleRow
                  label="Cascade Architecture"
                  detail={cascadeMode ? "Slave loop tracks Jacket Tc" : "Single primary loop"}
                  checked={cascadeMode}
                  onChange={() => setCascadeMode((v) => !v)}
                  accentColor="#3ba8ff"
                />

                <div style={{ marginTop: 14 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
                    <span style={{ fontSize: 12.5, color: "#8a94a6" }}>Setpoint T</span>
                    <span className="mono" style={{ fontSize: 18, fontWeight: 700, color: "#a78bfa" }}>
                      {setpoint.toFixed(1)} K
                    </span>
                  </div>
                  <input
                    type="range"
                    className="thermo-slider"
                    min={280}
                    max={420}
                    step={0.5}
                    value={setpoint}
                    disabled={controlsLocked}
                    onChange={(e) => setSetpoint(parseFloat(e.target.value))}
                  />
                </div>

                <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px dashed #1f2733" }}>
                  <div style={{ fontSize: 11, letterSpacing: 0.5, textTransform: "uppercase", color: "#a78bfa", marginBottom: 8, fontWeight: 600 }}>
                    Master PI (Reactor T)
                  </div>
                  
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
                    <span style={{ fontSize: 12, color: "#8a94a6" }}>Prop. Gain (Kp)</span>
                    <span className="mono" style={{ fontSize: 14, fontWeight: 700, color: "#3ba8ff" }}>
                      {kp.toFixed(2)}
                    </span>
                  </div>
                  <input
                    type="range"
                    className="thermo-slider"
                    min={0.1}
                    max={10.0}
                    step={0.1}
                    value={kp}
                    onChange={(e) => setKp(parseFloat(e.target.value))}
                  />

                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginTop: 10, marginBottom: 4 }}>
                    <span style={{ fontSize: 12, color: "#8a94a6" }}>Integral Time (tau_i)</span>
                    <span className="mono" style={{ fontSize: 14, fontWeight: 700, color: "#3ba8ff" }}>
                      {tauI.toFixed(2)} min
                    </span>
                  </div>
                  <input
                    type="range"
                    className="thermo-slider"
                    min={0.1}
                    max={3.0}
                    step={0.05}
                    value={tauI}
                    onChange={(e) => setTauI(parseFloat(e.target.value))}
                  />
                </div>

                {cascadeMode && (
                  <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px dashed #1f2733", background: "rgba(59, 168, 255, 0.05)", padding: "10px", borderRadius: 8 }}>
                    <div style={{ fontSize: 11, color: "#3ba8ff", marginBottom: 8, fontWeight: 600 }}>Slave PI (Jacket Tc)</div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
                      <span style={{ fontSize: 12, color: "#8a94a6" }}>Slave Prop. Gain (Kp)</span>
                      <span className="mono" style={{ fontSize: 14, fontWeight: 700, color: "#3ba8ff" }}>{slaveKp.toFixed(2)}</span>
                    </div>
                    <input type="range" className="thermo-slider" min={0.1} max={10.0} step={0.1} value={slaveKp} onChange={(e) => setSlaveKp(parseFloat(e.target.value))} />
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginTop: 10, marginBottom: 4 }}>
                      <span style={{ fontSize: 12, color: "#8a94a6" }}>Slave Int. Time (tau_i)</span>
                      <span className="mono" style={{ fontSize: 14, fontWeight: 700, color: "#3ba8ff" }}>{slaveTauI.toFixed(2)} min</span>
                    </div>
                    <input type="range" className="thermo-slider" min={0.05} max={1.0} step={0.05} value={slaveTauI} onChange={(e) => setSlaveTauI(parseFloat(e.target.value))} />
                  </div>
                )}
              </div>
            )}

            <div style={{ height: 1, background: "#1f2733", margin: "14px 0" }} />

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10 }}>
              <span style={{ fontSize: 12.5, color: "#8a94a6" }}>
                {autoMode ? (cascadeMode ? "Commanded Jacket Tc" : "Tc (controller output)") : "Setpoint Tc"}
              </span>
              <span className="mono" style={{ fontSize: 20, fontWeight: 700 }}>
                {tc.toFixed(1)} K
              </span>
            </div>
            <input
              type="range"
              className="thermo-slider"
              min={250}
              max={450}
              step={0.5}
              value={tc}
              disabled={autoMode || controlsLocked}
              onChange={(e) => handleTcChange(parseFloat(e.target.value))}
              style={autoMode || controlsLocked ? { opacity: 0.4, cursor: "not-allowed" } : undefined}
            />
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#5b6577", marginTop: 6 }}>
              <span>250 K · cold</span>
              <span>450 K · hot</span>
            </div>

            <div style={{ height: 1, background: "#1f2733", margin: "14px 0" }} />

            <ToggleRow
              label="Cutaway View"
              detail={cutawayOn ? "Vessel sliced open" : "Solid vessel"}
              checked={cutawayOn}
              onChange={() => setCutawayOn((v) => !v)}
              accentColor="#3ba8ff"
            />
          </Card>
        </div>

        <div style={{ flex: 1, position: "relative" }}>
          <Canvas
            camera={{ position: [4.5, 2.8, 4.5], fov: 42 }}
            shadows
            onCreated={({ gl }) => {
              gl.localClippingEnabled = true;
            }}
          >
            <color attach="background" args={["#05070a"]} />
            <fog attach="fog" args={["#05070a", 8, 18]} />
            <ReactorMesh
              getTemperature={() => liveTempRef.current}
              getCoolingTemp={() => tc}
              coldTemp={300}
              hotTemp={450}
              cutawayEnabled={cutawayOn}
            />
            <ContactShadows position={[0, -1.6, 0]} opacity={0.4} scale={10} blur={2.5} far={4} />
            <Grid
              position={[0, -1.6, 0]}
              args={[20, 20]}
              cellColor="#161d29"
              sectionColor="#212c3f"
              fadeDistance={12}
              infiniteGrid
            />
            <Environment preset="warehouse" />
            <OrbitControls enableDamping dampingFactor={0.08} minDistance={3} maxDistance={10} />
          </Canvas>

          <div
            style={{
              position: "absolute",
              top: 16,
              right: 16,
              padding: "8px 14px",
              borderRadius: 8,
              background: "rgba(13,17,25,0.7)",
              backdropFilter: "blur(6px)",
              border: esdActive || faulted ? "1px solid #ff5548" : "1px solid #1f2733",
              fontSize: 12,
              color: "#c3cad6",
            }}
          >
            T = <span className="mono" style={{ color: stateColor, fontWeight: 700 }}>{telemetry.T.toFixed(1)} K</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function ToggleRow({
  label,
  detail,
  checked,
  onChange,
  accentColor,
}: {
  label: string;
  detail: string;
  checked: boolean;
  onChange: () => void;
  accentColor: string;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
      <div>
        <div style={{ fontSize: 12.5, fontWeight: 600, color: "#eef1f6" }}>{label}</div>
        <div className="mono" style={{ fontSize: 10.5, color: checked ? accentColor : "#5b6577", marginTop: 2 }}>
          {detail}
        </div>
      </div>
      <label className="toggle-switch">
        <input type="checkbox" checked={checked} onChange={onChange} />
        <span
          className="toggle-slider"
          style={checked ? { background: `${accentColor}55`, borderColor: accentColor } : undefined}
        />
      </label>
    </div>
  );
}

function Card({ children, subtle = false }: { children: React.ReactNode; subtle?: boolean }) {
  return (
    <div
      className="fade-in"
      style={{
        padding: 13,
        borderRadius: 12,
        background: subtle ? "transparent" : "#0f1420",
        border: subtle ? "1px dashed #232c3a" : "1px solid #1f2733",
      }}
    >
      {children}
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 11, letterSpacing: 0.6, textTransform: "uppercase", color: "#5b6577", marginBottom: 12, fontWeight: 600 }}>
      {children}
    </div>
  );
}

function Metric({
  label,
  value,
  valueColor = "#eef1f6",
  mono = false,
}: {
  label: string;
  value: string;
  valueColor?: string;
  mono?: boolean;
}) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "5px 0" }}>
      <span style={{ fontSize: 12.5, color: "#8a94a6" }}>{label}</span>
      <span className={mono ? "mono" : ""} style={{ fontSize: 13, fontWeight: 600, color: valueColor }}>
        {value}
      </span>
    </div>
  );
}