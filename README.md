# CSTR Digital Twin

An interactive 3D digital twin of a non-isothermal Continuous Stirred-Tank Reactor (CSTR), built with React, TypeScript, and Three.js. It simulates real-time exothermic reaction kinetics, a consecutive side reaction, PI temperature control with anti-windup, and a latching Emergency Shutdown (ESD) safety interlock, all visualized live in a 3D reactor vessel you can rotate, cut away, and watch heat up and cool down in real time.

## Overview

This project was built to explore how a non-isothermal CSTR behaves under both normal operation and thermal runaway conditions, and to demonstrate what a modern digital twin interface for process safety and control could look like. It combines a physically-grounded dynamic model (based on a well-known textbook benchmark) with a set of original extensions: a consecutive side reaction that degrades product selectivity during a runaway, a latching safety interlock modeled after real Safety Instrumented Systems, and a suite of live visualizations (energy balance, reaction pathway, sensitivity analysis) to make the reactor's behavior legible rather than just a number climbing on a chart.

## Model Setup

### Governing Equations

The reactor is modeled as a lumped-parameter (perfectly mixed) CSTR with two irreversible reactions:

- **Main reaction:** A → B (desired product)
- **Consecutive side reaction:** B → C (undesired byproduct)

The state vector is `[Ca, Cb, T]` (concentration of A, concentration of B, reactor temperature).

**Mass balance on A:**

$$\frac{dC_A}{dt} = \frac{F}{V}(C_{A,f} - C_A) - k_1(T) C_A$$

**Mass balance on B:**

$$\frac{dC_B}{dt} = \frac{F}{V}(0 - C_B) + k_1(T) C_A - k_2(T) C_B$$

**Energy balance:**

$$\frac{dT}{dt} = \frac{F}{V}(T_f - T) + \frac{-\Delta H_{r,1}}{\rho C_p} k_1(T) C_A + \frac{-\Delta H_{r,2}}{\rho C_p} k_2(T) C_B - \frac{UA}{V\rho C_p}(T - T_c)$$

**Arrhenius rate constants:**

$$k_1(T) = k_{0,1} e^{-E_{a,1}/(RT)}, \qquad k_2(T) = k_{0,2} e^{-E_{a,2}/(RT)}$$

The system is integrated numerically using a fixed-step fourth-order Runge-Kutta (RK4) method.

### Parameter Table

| Parameter | Symbol | Value | Units | Source |
|---|---|---|---|---|
| Feed flow rate | F | 100 | L/min | Seborg et al., Example 2.5 |
| Reactor volume | V | 100 | L | Seborg et al., Example 2.5 |
| Feed concentration of A | C_Af | 1.0 | mol/L | Seborg et al., Example 2.5 |
| Feed temperature | T_f | 350 | K | Seborg et al., Example 2.5 |
| Pre-exponential factor (main) | k_0,1 | 7.2e10 | 1/min | Seborg et al., Example 2.5 |
| Activation energy (main) | E_a,1 | 8.314 × 8750 | J/mol | Seborg et al., Example 2.5 |
| Heat of reaction (main) | ΔH_r,1 | -5.0e4 | J/mol | Seborg et al., Example 2.5 |
| Density | ρ | 1000 | kg/m³ | Seborg et al., Example 2.5 |
| Heat capacity | C_p | 0.239 | J/(kg·K) | Seborg et al., Example 2.5 |
| Heat transfer coefficient | UA | 5.0e4 | J/(min·K) | Seborg et al., Example 2.5 |
| Coolant temperature | T_c | 300 (nominal) | K | Seborg et al., Example 2.5 |
| Pre-exponential factor (side) | k_0,2 | 6.159e20 | 1/min | This project (original) |
| Activation energy (side) | E_a,2 | 8.314 × 21514.7 | J/mol | This project (original) |
| Heat of reaction (side) | ΔH_r,2 | -2.0e4 | J/mol | This project (original) |
| ESD trip temperature | — | 440 | K | This project (original) |
| ESD reset temperature | — | 415 | K | This project (original) |

### Base Model vs. Original Extensions

The core kinetic and thermal parameters (F, V, C_Af, T_f, k_0,1, E_a,1, ΔH_r,1, ρ, C_p, UA) are taken directly from **Seborg, Edgar, Mellichamp & Doyle, *Process Dynamics and Control***, Example 2.5 / Table 2.3, a widely used benchmark for non-isothermal CSTR dynamics and control studies.

The following are **original extensions** added in this project:

- The consecutive side reaction (B → C), with its own Arrhenius parameters (k_0,2, E_a,2, ΔH_r,2), tuned so it remains negligible at normal operating temperature but accelerates sharply during a thermal runaway, visibly degrading selectivity to B.
- The latching ESD interlock and its trip/reset thresholds.
- The PI controller with direction-aware anti-windup.
- All visualization components (energy balance chart, reaction pathway diagram, sensitivity analysis panel, 3D vessel).

## Control & Safety Logic

### PI Controller with Anti-Windup

The temperature controller is a standard PI controller operating on reactor temperature, with **direction-aware anti-windup**: the integral term only stops accumulating when the output is saturated AND the current error would push it further into that same saturation direction. This lets the controller recover cleanly once the error reverses sign, instead of staying pinned at a limit due to a stale integral.

### Latching ESD Interlock

The Emergency Shutdown interlock is deliberately designed to **latch**, not auto-reset. Once reactor temperature crosses the trip threshold (440 K), the interlock forces coolant temperature to its minimum (250 K) and stays engaged even after temperature falls back below the reset threshold (415 K). Control only resumes after an explicit operator acknowledgment.

This mirrors how real Safety Instrumented Systems behave: auto-resetting the instant a threshold is crossed (while the underlying unsafe setpoint is still in effect) produces a trip/release/re-trip limit cycle, which is exactly the failure mode this design avoids. The 440 K trip / 415 K reset gap provides hysteresis to prevent rapid trip/reset chatter near the boundary.

## Scenarios

Three built-in presets demonstrate different aspects of the reactor's behavior:

1. **Cold Start** — Safe baseline: reactor initialized cold (Ca=1.0, T=300 K) with Tc=300 K, demonstrating stable low-temperature operation.
2. **Runaway Demo** — Drives the reactor toward thermal runaway by setting Tc=420 K, showing the temperature excursion, selectivity degradation, and ESD trip in action.
3. **Disturbance Rejection** — Auto (PI) control with a feed temperature fault (Tf +40 K) injected after 4 seconds, demonstrating the controller's ability to reject a sustained disturbance.

## Validation & Limitations

### Numerical Safeguards

- **Finite-value safety net:** After every integration step, the engine checks that all state values are finite. If a non-finite value is ever produced (e.g., from extreme parameter perturbations or disturbances), the engine freezes state at the last valid values and raises a fault flag, preventing NaN/Infinity from propagating into the UI or 3D render.
- **Hard physical bounds:** Temperature is clamped to [200, 700] K regardless of integration output, as a last-resort physical sanity check.

### Known Limitations

- **Lumped-parameter model:** Assumes perfect mixing, no spatial gradients in concentration or temperature.
- **Instantaneous jacket response:** Coolant temperature Tc is treated as an instantly-settable input, with no jacket thermal inertia or coolant flow dynamics.
- **Side-reaction kinetics tuned for stability, not fitted to data:** The B → C reaction parameters were chosen to be physically plausible (higher activation energy than the main reaction, so it's negligible at normal temperature) and numerically well-behaved with the fixed-step RK4 integrator, but were not fitted to experimental kinetic data.
- **Fixed-step RK4:** The integrator uses a fixed timestep rather than adaptive stepping, which limits how extreme a transient the model can resolve before numerical safeguards engage.

## Results

*(Screenshots and short clips of the energy balance chart, reaction pathway diagram, and a runaway/recovery sequence to be added here.)*

## References

- Seborg, D. E., Edgar, T. F., Mellichamp, D. A., & Doyle, F. J. (2016). *Process Dynamics and Control* (4th ed.). Wiley. Example 2.5 / Table 2.3.
