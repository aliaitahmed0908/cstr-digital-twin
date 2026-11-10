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
  const controllerRef = useRef<PIController>(new PIController(2.0, 0.6, 250, 450));
  const rafRef = useRef<number>(0);
  const lastTimeRef = useRef<number>(performance.now());
  const presetTimeoutsRef = useRef<number[]>([]);

  const [telemetry, setTelemetry] = useState({ Ca: 0.5, Cb: 0, T: 350, simTime: 0 });
  const [recordStats, setRecordStats] = useState({ count: 0, duration: 0 });
  const [tc, setTc] = useState(defaultParams.Tc);
  const [tfDisturbance, setTfDisturbance] = useState(false);
  const [flowDisturbance, setFlowDisturbance] = useState(false);
  const [autoMode, setAutoMode] = useState(false);
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
  const energyTermsRef = useRef<EnergyTerms>({ feed: 0, mainRxn: 0, sideRxn: 0, cooling: 0 });
  const ratesRef = useRef<ReactionRates>({ rate1: 0, rate2: 0 });
  const autoModeRef = useRef(autoMode);
  const setpointRef = useRef(setpoint);

  useEffect(() => {
    autoModeRef.current = autoMode;
    if (autoMode) controllerRef.current.reset();
  }, [autoMode]);

  useEffect(() => {
    setpointRef.current = setpoint;
  }, [setpoint]);

  useEffect(() => {
    const engine = engineRef.current;
    const controller = controllerRef.current;

    if (engine.getHistory().length === 0) {
      engine.resetState(0.5, 350); 
    }

    const loop = (now: number) => {
      const dtSeconds = Math.min((now - lastTimeRef.current) / 1000, 0.1);
      lastTimeRef.current = now;
      const simMinutesPerSecond = 0.5;

      if (autoModeRef.current && !engine.isEsdTripped()) {
        const dtMinutes = dtSeconds * simMinutesPerSecond;
        const { T } = engine.getState();
        const newTc = controller.compute(setpointRef.current, T, dtMinutes);
        engine.setTc(newTc);
        setTc(newTc);
      }

      engine.advanceRealTime(dtSeconds, simMinutesPerSecond, 4);
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
    engineRef.current.setDisturbance("Tf", false);
    engineRef.current.setDisturbance("F", false);
    engineRef.current.resetState(0.5, 350);
    engineRef.current.setTc(300);
    setTc(300);
    setFaulted(false);
    setEsdActive(false);
  };

  const handleAcknowledgeEsd = () => {
    const cleared = engineRef.current.acknowledgeEsd();
    if (cleared) {
      setAutoMode(false);
      engineRef.current.setTc(300);
      setTc(300);
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

    if (key === "cold") {
      setAutoMode(false);
      setTfDisturbance(false);
      setFlowDisturbance(false);
      engineRef.current.setDisturbance("Tf", false);
      engineRef.current.setDisturbance("F", false);
      engineRef.current.resetState(1.0, 300);
      engineRef.current.setTc(300);
      setTc(300);
    }

    if (key === "runaway") {
      setAutoMode(false);
      setTfDisturbance(false);
      setFlowDisturbance(false);
      engineRef.current.setDisturbance("Tf", false);
      engineRef.current.setDisturbance("F", false);
      engineRef.current.resetState(0.5, 350);
      engineRef.current.setTc(420);
      setTc(420);
    }

    if (key === "rejection") {
      setTfDisturbance(false);
      setFlowDisturbance(false);
      engineRef.current.setDisturbance("Tf", false);
      engineRef.current.setDisturbance("F", false);
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

  const anyDisturbanceActive = tfDisturbance || flowDisturbance;

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
              AUTO CONTROL
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
              DISTURBANCE ACTIVE
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
            <SectionLabel>Data Logging &amp; Export</SectionLabel>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
              <div>
                <div style={{ fontSize: 12.5, fontWeight: 600, color: "#eef1f6" }}>Telemetry Buffer</div>
                <div className="mono" style={{ fontSize: 10.5, color: "#5b6577", marginTop: 2 }}>
                  {recordStats.count} samples · {recordStats.duration.toFixed(2)} min
                </div>
              </div>
              <button
                onClick={handleExportCSV}
                disabled={recordStats.count === 0}
                style={{
                  padding: "6px 14px",
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
                Export CSV
              </button>
            </div>
            <div style={{ fontSize: 10.5, color: "#5b6577", lineHeight: 1.4 }}>
              Logs physical process state at every RK4 integration step. Resetting the reactor starts a new log file.
            </div>
          </Card>

          <Card>
            <SectionLabel>Live Telemetry</SectionLabel>
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
            <Metric label="Thermal State" value={thermalState} valueColor={stateColor} />
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
            <SectionLabel>Phase Portrait ($T$ vs $C_A$)</SectionLabel>
            <PhasePortraitChart
              getCa={() => liveCaRef.current}
              getT={() => liveTempRef.current}
              getTc={() => tc}
              getTf={() => tfDisturbance ? 390.0 : 350.0}
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
                  value={sensitivity