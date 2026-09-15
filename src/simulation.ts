// simulation.ts
export interface CSTRParams {
  F: number;
  V: number;
  Caf: number;
  Tf: number;
  k0: number;
  Ea: number;
  R: number;
  dHr: number;
  rho: number;
  Cp: number;
  UA: number;
  Tc: number;
}

export const defaultParams: CSTRParams = {
  F: 100,
  V: 100,
  Caf: 1.0,
  Tf: 350,
  k0: 7.2e10,
  Ea: 8.314 * 8750,
  R: 8.314,
  dHr: -5.0e4,
  rho: 1000,
  Cp: 0.239,
  UA: 5.0e4,
  Tc: 300,
};

const STATE_LEN = 2;

type DisturbanceKind = "Tf" | "F";

export class CSTREngine {
  params: CSTRParams;
  private state: Float64Array;
  private k1: Float64Array;
  private k2: Float64Array;
  private k3: Float64Array;
  private k4: Float64Array;
  private tmp: Float64Array;
  private deriv: Float64Array;
  private simTime = 0;

  private tfDisturbanceOn = false;
  private flowDisturbanceOn = false;
  private tfMagnitude = 40;
  private flowMagnitude = 40;

  constructor(initialCa = 0.5, initialT = 350, params: CSTRParams = defaultParams) {
    this.params = { ...params };
    this.state = new Float64Array(STATE_LEN);
    this.k1 = new Float64Array(STATE_LEN);
    this.k2 = new Float64Array(STATE_LEN);
    this.k3 = new Float64Array(STATE_LEN);
    this.k4 = new Float64Array(STATE_LEN);
    this.tmp = new Float64Array(STATE_LEN);
    this.deriv = new Float64Array(STATE_LEN);
    this.state[0] = initialCa;
    this.state[1] = initialT;
  }

  setTc(tc: number): void {
    this.params.Tc = Math.max(250, Math.min(450, tc));
  }

  getTc(): number {
    return this.params.Tc;
  }

  getTime(): number {
    return this.simTime;
  }

  getState(): { Ca: number; T: number } {
    return { Ca: this.state[0], T: this.state[1] };
  }

  resetState(Ca: number, T: number): void {
    this.state[0] = Ca;
    this.state[1] = T;
    this.simTime = 0;
  }

  /** Turns a sustained disturbance on/off. While on, the parameter is held
   *  at nominal + magnitude every step; while off, it's held at nominal. */
  setDisturbance(kind: DisturbanceKind, active: boolean): void {
    if (kind === "Tf") this.tfDisturbanceOn = active;
    else this.flowDisturbanceOn = active;
  }

  isDisturbanceOn(kind: DisturbanceKind): boolean {
    return kind === "Tf" ? this.tfDisturbanceOn : this.flowDisturbanceOn;
  }

  isAnyDisturbanceActive(): boolean {
    return this.tfDisturbanceOn || this.flowDisturbanceOn;
  }

  private applyDisturbances(): void {
    this.params.Tf = defaultParams.Tf + (this.tfDisturbanceOn ? this.tfMagnitude : 0);
    this.params.F = defaultParams.F + (this.flowDisturbanceOn ? this.flowMagnitude : 0);
  }

  private derivatives(s: Float64Array, out: Float64Array): void {
    const p = this.params;
    const Ca = s[0];
    const T = s[1];
    const k = p.k0 * Math.exp(-p.Ea / (p.R * T));
    const rate = k * Ca;
    const FoverV = p.F / p.V;
    out[0] = FoverV * (p.Caf - Ca) - rate;
    out[1] =
      FoverV * (p.Tf - T) +
      (-p.dHr / (p.rho * p.Cp)) * rate -
      (p.UA / (p.V * p.rho * p.Cp)) * (T - p.Tc);
  }

  step(dt: number): void {
    this.applyDisturbances();

    const s = this.state;
    const { k1, k2, k3, k4, tmp, deriv } = this;

    this.derivatives(s, deriv);
    k1[0] = deriv[0];
    k1[1] = deriv[1];

    tmp[0] = s[0] + (dt / 2) * k1[0];
    tmp[1] = s[1] + (dt / 2) * k1[1];
    this.derivatives(tmp, deriv);
    k2[0] = deriv[0];
    k2[1] = deriv[1];

    tmp[0] = s[0] + (dt / 2) * k2[0];
    tmp[1] = s[1] + (dt / 2) * k2[1];
    this.derivatives(tmp, deriv);
    k3[0] = deriv[0];
    k3[1] = deriv[1];

    tmp[0] = s[0] + dt * k3[0];
    tmp[1] = s[1] + dt * k3[1];
    this.derivatives(tmp, deriv);
    k4[0] = deriv[0];
    k4[1] = deriv[1];

    s[0] += (dt / 6) * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]);
    s[1] += (dt / 6) * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]);

    if (s[0] < 0) s[0] = 0;
    this.simTime += dt;
  }

  advanceRealTime(dtSeconds: number, simMinutesPerSecond = 0.5, substeps = 4): void {
    const totalSimMinutes = dtSeconds * simMinutesPerSecond;
    const h = totalSimMinutes / substeps;
    for (let i = 0; i < substeps; i++) {
      this.step(h);
    }
  }
}

/**
 * PI controller with direction-aware anti-windup: the integral term only
 * stops accumulating when the output is saturated AND the current error
 * would push it further into that same saturation direction. This lets
 * the controller recover cleanly once the error reverses sign, instead of
 * staying pinned at a limit due to a stale integral.
 */
export class PIController {
  Kp: number;
  Ki: number;
  outputMin: number;
  outputMax: number;
  private integral = 0;

  constructor(Kp = 2.0, Ki = 0.6, outputMin = 250, outputMax = 450) {
    this.Kp = Kp;
    this.Ki = Ki;
    this.outputMin = outputMin;
    this.outputMax = outputMax;
  }

  reset(): void {
    this.integral = 0;
  }

  /** Computes the next Tc command. dtMinutes must match the sim-time step. */
  compute(setpoint: number, measured: number, dtMinutes: number): number {
    const error = setpoint - measured;
    const rawOutput = this.Kp * error + this.Ki * this.integral;

    const saturatedHigh = rawOutput >= this.outputMax;
    const saturatedLow = rawOutput <= this.outputMin;
    const pushingFurtherHigh = saturatedHigh && error > 0;
    const pushingFurtherLow = saturatedLow && error < 0;

    if (!pushingFurtherHigh && !pushingFurtherLow) {
      this.integral += error * dtMinutes;
    }

    const output = this.Kp * error + this.Ki * this.integral;
    return Math.max(this.outputMin, Math.min(this.outputMax, output));
  }
}