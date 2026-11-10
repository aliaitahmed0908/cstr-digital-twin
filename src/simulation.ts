export type SensitivityKey = "Ea" | "k0" | "UA" | "dHr";
export const SENSITIVITY_KEYS: SensitivityKey[] = ["Ea", "k0", "UA", "dHr"];

export interface EnergyTerms {
  feed: number;
  mainRxn: number;
  sideRxn: number;
  cooling: number;
}

export interface ReactionRates {
  rate1: number;
  rate2: number;
}

// 1. FULL-RUN TELEMETRY INTERFACE
export interface TelemetryRecord {
  time_min: number;
  temperature_K: number;
  CA_mol_per_L: number;
  CB_mol_per_L: number;
  coolant_temperature_K: number;
  Qcool_J_per_min: number;
  conversion_pct: number;
  selectivity_B_pct: number;
  esd_latched: boolean;
}

export const defaultParams = {
  F: 100.0,       // Feed flow rate (L/min)
  V: 100.0,       // Reactor volume (L)
  Caf: 1.0,       // Feed concentration of A (mol/L)
  Tf: 350.0,      // Feed temperature (K)
  Tc: 300.0,      // Default coolant temperature (K)
  UA: 50000.0,    // Heat transfer coefficient (J/(min*K))
  rho: 1000.0,    // Density (g/L)
  Cp: 4.18,       // Heat capacity (J/(g*K))
  R: 8.314,       // Gas constant (J/(mol*K))
  
  // Main Reaction A -> B (Desired)
  k0: 7.2e10,     // Pre-exponential factor (1/min)
  Ea: 72750.0,    // Activation energy (J/mol)
  dHr: -50000.0,  // Heat of reaction (J/mol)
  
  // Side Reaction B -> C (Undesired extension)
  k02: 2.0e10,    // Pre-exponential factor (1/min)
  Ea2: 80000.0,   // Activation energy (J/mol)
  dHr2: -30000.0, // Heat of reaction (J/mol)
};

export class PIController {
  private Kp: number;
  private Ki: number;
  private outMin: number;
  private outMax: number;
  private integral: number = 0;

  constructor(Kp: number, Ki: number, outMin: number, outMax: number) {
    this.Kp = Kp;
    this.Ki = Ki;
    this.outMin = outMin;
    this.outMax = outMax;
  }

  public reset(): void {
    this.integral = 0;
  }

  public compute(setpoint: number, pv: number, dt: number): number {
    const error = setpoint - pv;
    const pTerm = this.Kp * error;
    
    // Direction-aware anti-windup
    let tentativeOut = pTerm + this.Ki * (this.integral + error * dt);
    if (tentativeOut > this.outMax) {
      if (error < 0) this.integral += error * dt;
    } else if (tentativeOut < this.outMin) {
      if (error > 0) this.integral += error * dt;
    } else {
      this.integral += error * dt;
    }

    const out = pTerm + this.Ki * this.integral;
    return Math.max(this.outMin, Math.min(this.outMax, out));
  }
}

export class CSTREngine {
  private params = { ...defaultParams };
  private baseParams = { ...defaultParams };
  private state = { Ca: 0.5, Cb: 0.0, T: 350.0 };
  
  private time = 0;
  private Tc = 300.0;
  
  private esdLatched = false;
  private faulted = false;
  
  // 2. FULL-RUN HISTORY BUFFER
  private history: TelemetryRecord[] = [];

  constructor(Ca0: number, T0: number, initialParams = defaultParams) {
    this.params = { ...initialParams };
    this.baseParams = { ...initialParams };
    this.Tc = this.params.Tc;
    this.resetState(Ca0, T0);
  }

  public resetState(Ca0: number, T0: number): void {
    this.state = { Ca: Ca0, Cb: 0.0, T: T0 };
    this.time = 0;
    this.esdLatched = false;
    this.faulted = false;
    this.history = [];
    
    // Log the exact t=0 initial state immediately
    this.recordHistoryStep();
  }

  public getHistory(): TelemetryRecord[] {
    return this.history;
  }

  // 3. TELEMETRY RECORDER LOGIC
  private recordHistoryStep(): void {
    if (this.faulted) return; // Do not log NaN/Inf during numerical blowups

    const { Ca, Cb, T } = this.state;
    const Caf = this.params.Caf;
    
    const conversion = (1 - Ca / Caf) * 100;
    const totalConverted = Caf - Ca;
    const selectivity = totalConverted > 1e-6 ? (Cb / totalConverted) * 100 : 100;
    
    // Qcool = UA * (T - Tc). Physical convention: positive value means heat LEAVES the reactor.
    // We use the live applied Tc, which correctly reflects any forced 250K ESD overrides.
    const Qcool = this.params.UA * (T - this.Tc);

    this.history.push({
      time_min: this.time,
      temperature_K: T,
      CA_mol_per_L: Ca,
      CB_mol_per_L: Cb,
      coolant_temperature_K: this.Tc,
      Qcool_J_per_min: Qcool,
      conversion_pct: conversion,
      selectivity_B_pct: selectivity,
      esd_latched: this.esdLatched
    });
  }

  public setTc(newTc: number): void {
    if (!this.esdLatched) {
      this.Tc = newTc;
    }
  }

  public setDisturbance(type: "Tf" | "F", active: boolean): void {
    if (type === "Tf") {
      this.params.Tf = active ? this.baseParams.Tf + 40.0 : this.baseParams.Tf;
    } else if (type === "F") {
      this.params.F = active ? this.baseParams.F + 40.0 : this.baseParams.F;
    }
  }

  public resetSensitivityParams(): void {
    SENSITIVITY_KEYS.forEach((key) => {
      this.params[key] = this.baseParams[key];
    });
  }

  public setSensitivityParam(key: SensitivityKey, value: number): void {
    this.params[key] = value;
  }

  public getState() {
    return { ...this.state };
  }

  public getTime() {
    return this.time;
  }

  public isEsdTripped() {
    return this.esdLatched;
  }

  public isEsdResetPermitted() {
    return this.esdLatched && this.state.T <= 415.0;
  }

  public isFaulted() {
    return this.faulted;
  }

  public acknowledgeEsd(): boolean {
    if (this.isEsdResetPermitted()) {
      this.esdLatched = false;
      return true;
    }
    return false;
  }

  private getDerivatives(Ca: number, Cb: number, T: number) {
    const { F, V, Caf, Tf, rho, Cp, R, k0, Ea, dHr, k02, Ea2, dHr2, UA } = this.params;
    
    // Kinetics
    const k1 = k0 * Math.exp(-Ea / (R * T));
    const k2 = k02 * Math.exp(-Ea2 / (R * T));
    
    const rate1 = k1 * Ca;
    const rate2 = k2 * Cb;
    
    // Mass balances
    const dCa = (F / V) * (Caf - Ca) - rate1;
    const dCb = (F / V) * (0 - Cb) + rate1 - rate2;
    
    // Energy balance terms (K/min)
    const rhoCp = rho * Cp;
    const feed = (F / V) * (Tf - T);
    const mainRxn = (Math.abs(dHr) / rhoCp) * rate1;
    const sideRxn = (Math.abs(dHr2) / rhoCp) * rate2;
    const cooling = (UA / (rhoCp * V)) * (this.Tc - T);
    
    const dT = feed + mainRxn + sideRxn + cooling;
    
    return { dCa, dCb, dT, feed, mainRxn, sideRxn, cooling, rate1, rate2 };
  }

  public getEnergyTerms(): EnergyTerms {
    if (this.faulted) return { feed: 0, mainRxn: 0, sideRxn: 0, cooling: 0 };
    const d = this.getDerivatives(this.state.Ca, this.state.Cb, this.state.T);
    return {
      feed: d.feed,
      mainRxn: d.mainRxn,
      sideRxn: d.sideRxn,
      cooling: d.cooling
    };
  }

  public getRates(): ReactionRates {
    if (this.faulted) return { rate1: 0, rate2: 0 };
    const d = this.getDerivatives(this.state.Ca, this.state.Cb, this.state.T);
    return {
      rate1: d.rate1,
      rate2: d.rate2
    };
  }

  // 4. SOLVER INTEGRATION LOOP
  public advanceRealTime(dtSeconds: number, simMinutesPerSecond: number, substeps: number): void {
    if (this.faulted) return;
    
    const dtSimMinutes = dtSeconds * simMinutesPerSecond;
    if (dtSimMinutes <= 0) return; // Prevent logging identical rows while paused
    
    const dtStep = dtSimMinutes / substeps;

    for (let i = 0; i < substeps; i++) {
      this.step(dtStep);
      
      if (this.faulted) break; // Freeze state and abort logging on NaN
      
      // Log exactly one row per accepted solver step
      this.recordHistoryStep();
    }
  }

  private step(dt: number) {
    const { Ca, Cb, T } = this.state;

    // Runge-Kutta 4th Order Integration
    const k1 = this.getDerivatives(Ca, Cb, T);
    const k2 = this.getDerivatives(Ca + 0.5 * dt * k1.dCa, Cb + 0.5 * dt * k1.dCb, T + 0.5 * dt * k1.dT);
    const k3 = this.getDerivatives(Ca + 0.5 * dt * k2.dCa, Cb + 0.5 * dt * k2.dCb, T + 0.5 * dt * k2.dT);
    const k4 = this.getDerivatives(Ca + dt * k3.dCa, Cb + dt * k3.dCb, T + dt * k3.dT);

    const nextCa = Ca + (dt / 6) * (k1.dCa + 2 * k2.dCa + 2 * k3.dCa + k4.dCa);
    const nextCb = Cb + (dt / 6) * (k1.dCb + 2 * k2.dCb + 2 * k3.dCb + k4.dCb);
    const nextT = T + (dt / 6) * (k1.dT + 2 * k2.dT + 2 * k3.dT + k4.dT);

    // Safeguard check
    if (!Number.isFinite(nextCa) || !Number.isFinite(nextCb) || !Number.isFinite(nextT)) {
      this.faulted = true;
      return;
    }

    this.state.Ca = Math.max(0, nextCa);
    this.state.Cb = Math.max(0, nextCb);
    this.state.T = Math.max(200, Math.min(700, nextT)); // Hard physical bounds

    // Emergency Shutdown (ESD) Latch Logic
    if (this.state.T >= 440.0) {
      this.esdLatched = true;
    }
    if (this.esdLatched) {
      this.Tc = 250.0; // Force max cooling override
    }

    this.time += dt;
  }
}