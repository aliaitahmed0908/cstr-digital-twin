import { useEffect, useRef, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, Environment, ContactShadows, Grid } from "@react-three/drei";
import { CSTREngine, defaultParams, PIController } from "./simulation";
import { ReactorMesh } from "./ReactorMesh";
import { TelemetryChart } from "./TelemetryChart";
import { PhasePortraitChart } from "./PhasePortraitChart";

const COLD_T = 300;
const HOT_T = 450;

type PresetKey = "cold" | "runaway" | "rejection";

export default function App() {
  const engineRef = useRef<CSTREngine>(new CSTREngine(0.5, 350, defaultParams));
  const controllerRef = useRef<PIController>(new PIController(2.0, 0.6, 250, 450));
  const rafRef = useRef<number>(0);
  const lastTimeRef = useRef<number>(performance.now());
  const presetTimeoutsRef = useRef<number[]>([]);

  const [telemetry, setTelemetry] = useState({ Ca: 0.5, Cb: 0, T: 350, simTime: 0 });
  const [tc, setTc] = useState(defaultParams.Tc);
  const [tfDisturbance, setTfDisturbance] = useState(false);
  const [flowDisturbance, setFlowDisturbance] = useState(false);
  const [autoMode, setAutoMode] = useState(false);
  const [setpoint, setSetpoint] = useState(330);
  const [activePreset, setActivePreset] = useState<PresetKey | null>(null);
  const [cutawayOn, setCutawayOn] = useState(false);
  const [esdActive, setEsdActive] = useState(false);

  const liveTempRef = useRef(350);
  const liveCaRef = useRef(0.5);
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

    const loop = (now: number) => {
      const dtSeconds = Math.min((now - lastTimeRef.current) / 1000, 0.1);
      lastTimeRef.current = now;
      const simMinutesPerSecond = 0.5;

      if (autoModeRef.current) {
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
      setTelemetry({ Ca, Cb, T, simTime: engine.getTime() });
      setEsdActive(engine.isEsdTripped());
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

  const handlePresetToggle = (key: PresetKey) => {
    if (activePreset === key) {
      stopPreset();
      return;
    }

    clearPresetTimeouts();
    setActivePreset(key);

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

  const anyDisturbanceActive = tfDisturbance || flowDisturbance;

  const thermalState =
    telemetry.T > 400 ? "RUNAWAY RISK" : telemetry.T > 370 ? "ELEVATED" : "NOMINAL";

  const stateColor =
    thermalState === "RUNAWAY RISK" ? "#ff5548" : thermalState === "ELEVATED" ? "#ffb545" : "#34d399";

  const conversion = (1 - telemetry.Ca / defaultParams.Caf) * 100;
  const totalConverted = defaultParams.Caf - telemetry.Ca;
  // Selectivity: what fraction of converted A is still present as desired
  // product B, versus having degraded further into byproduct C. Falls back
  // to 100% before any conversion has occurred (avoids divide-by-zero).
  const selectivity = totalConverted > 1e-6 ? (telemetry.Cb / totalConverted) * 100 : 100;

  const controlsLocked = esdActive;

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
          {esdActive && (
            <div style={{ display: "flex", alignItems: "center", fontSize: 11.5, color: "#ff5548", fontWeight: 700 }}>
              <span className="status-dot" style={{ background: "#ff5548" }} />
              ESD TRIPPED
            </div>
          )}
          {autoMode && !esdActive && (
            <div style={{ display: "flex", alignItems: "center", fontSize: 11.5, color: "#a78bfa" }}>
              <span className="status-dot" style={{ background: "#a78bfa" }} />
              AUTO CONTROL
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

      {esdActive && (
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
            gap: 10,
            letterSpacing: 0.3,
            flexShrink: 0,
          }}
        >
          <span style={{ fontSize: 16 }}>⚠</span>
          EMERGENCY SHUTDOWN ACTIVE — Tc forced to minimum (250 K) until reactor temperature falls below 415 K.
          Manual and auto control are locked out.
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
            <SectionLabel>Phase Portrait</SectionLabel>
            <PhasePortraitChart
              getCa={() => liveCaRef.current}
              getT={() => liveTempRef.current}
              caMin={0}
              caMax={1.0}
              tMin={260}
              tMax={460}
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
            <SectionLabel>Temperature Control</SectionLabel>

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
                ESD interlock active — controls locked until T ≤ 415 K
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
            )}

            <div style={{ height: 1, background: "#1f2733", margin: "14px 0" }} />

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10 }}>
              <span style={{ fontSize: 12.5, color: "#8a94a6" }}>
                {autoMode ? "Tc (controller output)" : "Setpoint Tc"}
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
              coldTemp={COLD_T}
              hotTemp={HOT_T}
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
              border: esdActive ? "1px solid #ff5548" : "1px solid #1f2733",
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