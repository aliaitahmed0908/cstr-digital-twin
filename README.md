CSTR Digital Twin
An interactive, web-based digital twin of a non-isothermal Continuous Stirred-Tank Reactor (CSTR), built with Vite, React, TypeScript, and Three.js (via @react-three/fiber). It combines a real-time numerical physics engine, a live telemetry dashboard, and a temperature-reactive 3D vessel to visualize reactor dynamics, thermal runaway risk, and closed-loop process control — all running client-side in the browser.



What This Demonstrates
This project models a classic chemical engineering control problem: a single first-order exothermic reaction (A → B) occurring in a jacketed CSTR, where the reactor exhibits bistable steady-state behavior — the same cooling jacket temperature can correspond to either a safe, low-conversion state or a dangerous, high-temperature runaway state, depending on the reactor's history. The app lets you explore this nonlinear dynamics problem interactively, then close the loop with a working PI controller to actively reject disturbances and hold a target temperature.

Governing Equations
The reactor is modeled with the standard non-isothermal CSTR mass and energy balance:

Mass balance (reactant concentration, Ca):

text
dCa/dt = (F/V)(Caf - Ca) - k0 * exp(-Ea / (R*T)) * Ca
Energy balance (reactor temperature, T):

text
dT/dt = (F/V)(Tf - T) + (-ΔHr / (ρ*Cp)) * k0 * exp(-Ea / (R*T)) * Ca - (UA / (V*ρ*Cp)) * (T - Tc)
Where F is feed flow rate, V is reactor volume, Caf/Tf are feed concentration/temperature, k0/Ea are Arrhenius kinetic parameters, ΔHr is heat of reaction, ρ/Cp are density/heat capacity, UA is the jacket heat transfer coefficient, and Tc is the cooling jacket temperature — the primary manipulated variable in this app.

These equations are integrated numerically using 4th-order Runge-Kutta (RK4), chosen for its stability and accuracy on this moderately stiff nonlinear ODE system.

Architecture
File	Responsibility
simulation.ts	CSTREngine (RK4 integrator, pre-allocated Float64Array state buffers to avoid GC pauses), disturbance injection, and PIController (closed-loop temperature control with anti-windup)
App.tsx	Dashboard UI, requestAnimationFrame telemetry loop, scenario presets, control state
ReactorMesh.tsx	3D vessel (Three.js cylinder + dome caps), animated agitator, particle-based flow visualization, live thermal color interpolation
TelemetryChart.tsx	Canvas-based rolling time-series chart of Ca and T
PhasePortraitChart.tsx	Canvas-based Ca-vs-T phase plane trajectory plot
Performance Notes
The physics engine uses pre-allocated Float64Array buffers for all RK4 intermediate calculations (k1–k4, scratch state, derivatives), so the 60 FPS simulation loop performs zero heap allocations per frame — avoiding garbage collection pauses that would otherwise cause visible stutter. The 3D particle system and both charts follow the same pattern, using Float32Array/Float64Array ring buffers updated in place rather than creating new objects every frame.

Features
Live telemetry dashboard — Ca, T, conversion %, and thermal state (NOMINAL / ELEVATED / RUNAWAY RISK), updating at 60 FPS.

Interactive cooling jacket control — a real-time slider for Tc that instantly shifts reactor thermodynamics.

Sustained disturbance toggles — inject a feed temperature fault (+40 K) or feed flow fault (+40 L/min) to simulate upstream process upsets.

Closed-loop PI control — switch from manual Tc control to an automatic controller that holds a target setpoint temperature, including proper direction-aware anti-windup (see below).

Scenario presets — one-click Cold Start, Runaway Demo, and Disturbance Rejection Demo toggles for fast, repeatable demonstrations.

3D reactive vessel — a Three.js cylinder that smoothly interpolates from blue (cold) to red (hot/exothermic runaway), with an animated agitator (rotation speed scales with temperature) and a swirling particle field representing fluid circulation.

Transient response chart — rolling 30-second time-series of Ca and T.

Phase portrait — a Ca-vs-T trajectory plot that visually reveals the reactor's bistable operating curve.

Technical Challenge: Diagnosing a Controller Anti-Windup Bug
During development, the PI controller was observed getting permanently "stuck" at its minimum output limit (Tc = 250 K) even after the process temperature dropped below setpoint — a state where the controller should have been raising Tc, not holding it at maximum cooling.

Root cause: the initial anti-windup implementation froze the integral term any time the output was saturated, without checking which direction the error was trying to push it. Once the integral wound up deeply negative while the output was saturated low, it stayed frozen even after the error reversed sign, because the freeze condition only checked "is output currently out of bounds," not "is the error making it worse or better."

Fix: implemented direction-aware conditional integration — the integral only stops accumulating when the output is saturated and the current error would push it further into that same saturation direction. If the error is trying to pull the output back into range, integration continues normally, allowing the controller to recover cleanly. This is a standard technique in industrial PID implementations but is easy to get subtly wrong, as this project demonstrated firsthand.

Getting Started
bash
npm install
npm run dev
Open the printed local URL (typically http://localhost:5173) in your browser.

Dependencies
three, @react-three/fiber, @react-three/drei for 3D rendering

No external charting or state management libraries — telemetry charts and the physics engine are implemented from scratch using the HTML Canvas API and pre-allocated typed arrays

Possible Extensions
Export telemetry history as CSV for offline analysis in MATLAB/Python

Multi-reactant reaction network (e.g., Van de Vusse kinetics)

Cascade control (secondary flow loop feeding the temperature loop)

WebSocket-based multi-user shared simulation state

License
MIT