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
  // Consecutive side reaction B -> C. Deliberately given a much higher
  // activation energy than the main reaction, so it's negligible at normal
  // operating temperature but accelerates sharply during a runaway,
  // consuming desired product B and forming an undesired byproduct C.
  k0b: number;
  Eab: number;
  dHrb: number;
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
  k0b: 4.5e14,
  Eab: 8.314 * 11500,
  dHrb: -3.0e4,
};

// State vector: [Ca, Cb, T]
const STATE_LEN = 3;

type DisturbanceKind = "Tf" | "F";

// ESD (Emergency Shutdown) interlock thresholds. Independent of the PI
// controller and the manual Tc slider — this models a Safety Instrumented
// System that overrides normal control the moment temperature crosses a
// hard limit, and only releases control back once temperature has fallen
// well below that limit (hysteresis prevents rapid trip/reset chatter).
const ESD_TRIP_TEMP = 440;
const ESD_RESET_TEMP = 415;

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

  private esdTripped = false;

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
    this.state[1] = 0; // Cb starts at zero, no product B in the initial fill
    this.state[2] = initialT;
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

  getState(): { Ca: number; Cb: number; T: number } {
    return { Ca: this.state[0], Cb: this.state[1], T: this.state[2] };
  }

  resetState(Ca: number, T: number): void {
    this.state[0] = Ca;
    this.state[1] = 0;
    this.state[2] = T;
    this.simTime = 0;
    this.esdTripped = false;
  }

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

  /** True while the ESD interlock is actively overriding Tc. */
  isEsdTripped(): boolean {
    return this.esdTripped;
  }

  private applyDisturbances(): void {
    this.params.Tf = defaultParams.Tf + (this.tfDisturbanceOn ? this.tfMagnitude : 0);
    this.params.F = defaultParams.F + (this.flowDisturbanceOn ? this.flowMagnitude : 0);
  }

  /** Checks current temperature against the ESD thresholds and updates the
   *  trip state with hysteresis. Called once per real-time frame, not per
   *  RK4 substep, so it reacts to the measured temperature rather than an
   *  intermediate slope estimate. */
  private updateEsd(): void {
    const T = this.state[2];
    if (!this.esdTripped && T >= ESD_TRIP_TEMP) {
      this.esdTripped = true;
    } else if (this.esdTripped && T <= ESD_RESET_TEMP) {
      this.esdTripped = false;
    }
  }

  /** The Tc value actually used by the physics, as opposed to the
   *  commanded value in params.Tc. When tripped, the ESD forces full
   *  cooling regardless of manual or auto control, without overwriting
   *  the user's setpoint — so control resumes smoothly once it clears. */
  private effectiveTc(): number {
    return this.esdTripped ? 250 : this.params.Tc;
  }

  private derivatives(s: Float64Array, out: Float64Array): void {
    const p = this.params;
    const Ca = s[0];
    const Cb = s[1];
    const T = s[2];
    const Tc = this.effectiveTc();

    const kRate1 = p.k0 * Math.exp(-p.Ea / (p.R * T));
    const rate1 = kRate1 * Ca;

    const kRate2 = p.k0b * Math.exp(-p.Eab / (p.R * T));
    const rate2 = kRate2 * Cb;

    const FoverV = p.F / p.V;

    out[0] = FoverV * (p.Caf - Ca) - rate1;
    out[1] = FoverV * (0 - Cb) + rate1 - rate2;
    out[2] =
      FoverV * (p.Tf - T) +
      (-p.dHr / (p.rho * p.Cp)) * rate1 +
      (-p.dHrb / (p.rho * p.Cp)) * rate2 -
      (p.UA / (p.V * p.rho * p.Cp)) * (T - Tc);
  }

  step(dt: number): void {
    this.applyDisturbances();

    const s = this.state;
    const { k1, k2, k3, k4, tmp, deriv } = this;

    this.derivatives(s, deriv);
    k1[0] = deriv[0];
    k1[1] = deriv[1];
    k1[2] = deriv[2];

    tmp[0] = s[0] + (dt / 2) * k1[0];
    tmp[1] = s[1] + (dt / 2) * k1[1];
    tmp[2] = s[2] + (dt / 2) * k1[2];
    this.derivatives(tmp, deriv);
    k2[0] = deriv[0];
    k2[1] = deriv[1];
    k2[2] = deriv[2];

    tmp[0] = s[0] + (dt / 2) * k2[0];
    tmp[1] = s[1] + (dt / 2) * k2[1];
    tmp[2] = s[2] + (dt / 2) * k2[2];
    this.derivatives(tmp, deriv);
    k3[0] = deriv[0];
    k3[1] = deriv[1];
    k3[2] = deriv[2];

    tmp[0] = s[0] + dt * k3[0];
    tmp[1] = s[1] + dt * k3[1];
    tmp[2] = s[2] + dt * k3[2];
    this.derivatives(tmp, deriv);
    k4[0] = deriv[0];
    k4[1] = deriv[1];
    k4[2] = deriv[2];

    s[0] += (dt / 6) * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]);
    s[1] += (dt / 6) * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]);
    s[2] += (dt / 6) * (k1[2] + 2 * k2[2] + 2 * k3[2] + k4[2]);

    if (s[0] < 0) s[0] = 0;
    if (s[1] < 0) s[1] = 0;
    this.simTime += dt;
  }

  advanceRealTime(dtSeconds: number, simMinutesPerSecond = 0.5, substeps = 4): void {
    const totalSimMinutes = dtSeconds * simMinutesPerSecond;
    const h = totalSimMinutes / substeps;
    for (let i = 0; i < substeps; i++) {
      this.step(h);
    }
    // Check the interlock once per real-time frame, against the settled
    // measured temperature, not mid-substep.
    this.updateEsd();
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