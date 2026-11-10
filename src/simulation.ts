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
  F: 100.0,
  V: 100.0,
  Caf: 1.0,
  Tf: 350.0,
  Tc: 300.0,
  UA: 50000.0,
  rho: 1000.0,
  Cp: 4.18,
  R: 8.314,
  
  k0: 7.2e10,
  Ea: 72750.0,
  dHr: -50000.0,
  
  k02: 2.0e10,
  Ea2: 80000.0,
  dHr2: -30000.0,
};

export class PIController {
  private Kp: number;
  private TauI: number; // Integral time (minutes)
  private outMin: number;
  private outMax: number;
  private integral: number = 0;

  constructor(Kp: number, tauI: number, outMin: number, outMax: number) {
    this.Kp = Kp;
    this.TauI = Math.max(1e-4, tauI);
    this.outMin = outMin;
    this.outMax = outMax;
  }

  public setTunings(Kp: number, tauI: number): void {
    this.Kp = Kp;
    this.TauI = Math.max(1e-4, tauI);
  }

  public reset(): void {
    this.integral = 0;
  }

  public compute(setpoint: number, pv: number, dt: number): number {
    const error = setpoint - pv;
    const pTerm = this.Kp * error;
    const ki = this.Kp / this.TauI;
    
    let tentativeOut = pTerm + ki * (this.integral + error * dt);
    if (tentativeOut > this.outMax) {
      if (error < 0) this.integral += error * dt;
    } else if (tentativeOut < this.outMin) {
      if (error > 0) this.integral += error * dt;
    } else {
      this.integral += error * dt;
    }

    const out = pTerm + ki * this.integral;
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
  
  private uaFailed = false;
  private agitatorTripped = false;
  private cafSpikeActive = false;

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
    this.uaFailed = false;
    this.agitatorTripped = false;
    this.cafSpikeActive = false;
    this.history = [];
    
    this.recordHistoryStep();
  }

  public getHistory(): TelemetryRecord[] {
    return this.history;
  }

  private recordHistoryStep(): void {
    if (this.faulted) return;

    const { Ca, Cb, T } = this.state;
    const effectiveCaf = this.cafSpikeActive ? this.baseParams.Caf * 2.5 : this.params.Caf;
    
    const conversion = (1 - Ca / effectiveCaf) * 100;
    const totalConverted = effectiveCaf - Ca;
    const selectivity = totalConverted > 1e-6 ? (Cb / totalConverted) * 100 : 100;
    
    const uaMultiplier = (this.uaFailed ? 0.02 : 1.0) * (this.agitatorTripped ? 0.15 : 1.0);
    const effectiveUA = this.params.UA * uaMultiplier;
    const Qcool = effectiveUA * (T - this.Tc);

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

  public setFault(fault: "ua" | "agitator" | "caf", active: boolean): void {
    if (fault === "ua") this.uaFailed = active;
    if (fault === "agitator") this.agitatorTripped = active;
    if (fault === "caf") this.cafSpikeActive = active;
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
    const { F, V, Tf, rho, Cp, R, k0, Ea, dHr, k02, Ea2, dHr2, UA } = this.params;
    const Caf = this.cafSpikeActive ? this.baseParams.Caf * 2.5 : this.params.Caf;
    
    const k1 = k0 * Math.exp(-Ea / (R * T));
    const k2 = k02 * Math.exp(-Ea2 / (R * T));
    
    const rate1 = k1 * Ca;
    const rate2 = k2 * Cb;
    
    const dCa = (F / V) * (Caf - Ca) - rate1;
    const dCb = (F / V) * (0 - Cb) + rate1 - rate2;
    
    const uaMultiplier = (this.uaFailed ? 0.02 : 1.0) * (this.agitatorTripped ? 0.15 : 1.0);
    const effectiveUA = UA * uaMultiplier;

    const rhoCp = rho * Cp;
    const feed = (F / V) * (Tf - T);
    const mainRxn = (Math.abs(dHr) / rhoCp) * rate1;
    const sideRxn = (Math.abs(dHr2) / rhoCp) * rate2;
    const cooling = (effectiveUA / (rhoCp * V)) * (this.Tc - T);
    
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

  public advanceRealTime(dtSeconds: number, simMinutesPerSecond: number, substeps: number): void {
    if (this.faulted) return;
    
    const dtSimMinutes = dtSeconds * simMinutesPerSecond;
    if (dtSimMinutes <= 0) return;
    
    const dtStep = dtSimMinutes / substeps;

    for (let i = 0; i < substeps; i++) {
      this.step(dtStep);
      
      if (this.faulted) break;
      
      this.recordHistoryStep();
    }
  }

  private step(dt: number) {
    const { Ca, Cb, T } = this.state;

    const k1 = this.getDerivatives(Ca, Cb, T);
    const k2 = this.getDerivatives(Ca + 0.5 * dt * k1.dCa, Cb + 0.5 * dt * k1.dCb, T + 0.5 * dt * k1.dT);
    const k3 = this.getDerivatives(Ca + 0.5 * dt * k2.dCa, Cb + 0.5 * dt * k2.dCb, T + 0.5 * dt * k2.dT);
    const k4 = this.getDerivatives(Ca + dt * k3.dCa, Cb + dt * k3.dCb, T + dt * k3.dT);

    const nextCa = Ca + (dt / 6) * (k1.dCa + 2 * k2.dCa + 2 * k3.dCa + k4.dCa);
    const nextCb = Cb + (dt / 6) * (k1.dCb + 2 * k2.dCb + 2 * k3.dCb + k4.dCb);
    const nextT = T + (dt / 6) * (k1.dT + 2 * k2.dT + 2 * k3.dT + k4.dT);

    if (!Number.isFinite(nextCa) || !Number.isFinite(nextCb) || !Number.isFinite(nextT)) {
      this.faulted = true;
      return;
    }

    this.state.Ca = Math.max(0, nextCa);
    this.state.Cb = Math.max(0, nextCb);
    this.state.T = Math.max(200, Math.min(700, nextT));

    if (this.state.T >= 440.0) {
      this.esdLatched = true;
    }
    if (this.esdLatched) {
      this.Tc = 250.0;
    }

    this.time += dt;
  }
}