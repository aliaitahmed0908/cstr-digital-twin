
CSTR Digital Twin
Live demo → https://alis-cstr-digital-twin.vercel.app/

An interactive, web-based digital twin of a non-isothermal Continuous Stirred-Tank Reactor (CSTR). Built with Vite, React, TypeScript, and Three.js (via @react-three/fiber), it pairs a real-time numerical physics engine with a live telemetry dashboard and a temperature-reactive 3D vessel, so you can actually watch reactor dynamics, thermal runaway risk, and closed-loop process control play out instead of just reading about them. Everything runs client-side in the browser.

Thermal State: NOMINAL

Motivation
This started from a question rather than a feature list: what actually makes chemical engineering consulting hard, beyond the thermodynamics itself? Looking into that turned up a theme that shows up again and again in engineering-communication literature. The real bottleneck usually isn't computing the right answer. It's getting a non-technical client, financial stakeholder, or operator to understand that answer well enough to actually trust it. Engineers tend to be trained as diagnostic listeners who jump straight to a technical fix, but clients are often trying to express operational anxiety or business risk, and a wall of equations or a static PDF rarely closes that gap.

One idea that keeps coming up as a fix is the "digital twin," though the term gets stretched pretty thin in practice. There's a real difference between a static digital model (you drive it manually, no live data feed), a digital shadow (a one-way feed from sensors into a visualization), and an actual digital twin (two-way, closed-loop control). For a student project meant to make reactor behavior tangible to someone without a chemical engineering background, building a properly interactive digital model that behaves dynamically in real time is the realistic target. You don't need live plant sensors to prove the point that watching a system respond beats reading a paragraph about it.

That's basically the gap this project is trying to close, just at a small scale. Instead of describing thermal runaway or controller behavior in the abstract, you can drag a slider, throw in a disturbance, and watch the reactor's temperature either settle down or run away in real time. It's the same instinct behind why HAZOP-style hazard reviews are leaning more on simulation these days, rather than asking a room full of people to mentally model cascading pressure or temperature deviations off a P&ID alone.

What This Demonstrates
This models a classic chemical engineering control problem: a first-order exothermic reaction (A → B) in a jacketed CSTR. The reactor shows bistable steady-state behavior, meaning the exact same cooling jacket temperature can correspond to either a safe, low-conversion state or a dangerous, high-temperature runaway state, depending on how the reactor got there. You can explore that nonlinear behavior interactively, then close the loop with a working PI controller that actively rejects disturbances and holds a target temperature.

Governing Equations
The reactor is modeled with the standard non-isothermal CSTR mass and energy balance.

Mass balance (reactant concentration, Ca):

text
dCa/dt = (F/V)(Caf - Ca) - k0 * exp(-Ea / (R*T)) * Ca
Energy balance (reactor temperature, T):

text
dT/dt = (F/V)(Tf - T) + (-ΔHr / (ρ*Cp)) * k0 * exp(-Ea / (R*T)) * Ca - (UA / (V*ρ*Cp)) * (T - Tc)
Here F is feed flow rate, V is reactor volume, Caf/Tf are feed concentration/temperature, k0/Ea are the Arrhenius kinetic parameters, ΔHr is heat of reaction, ρ/Cp are density and specific heat capacity, UA is the jacket heat transfer coefficient, and Tc is the cooling jacket temperature, which is the main thing you're controlling in this app.

These are integrated numerically with 4th-order Runge-Kutta (RK4). Simpler methods like Euler integration tend to go unstable here, since the reaction rate and temperature are tightly coupled and the system gets moderately stiff.

Architecture
File	Responsibility
simulation.ts	CSTREngine (RK4 integrator, pre-allocated Float64Array state buffers to avoid GC pauses), disturbance injection, and PIController (closed-loop temperature control with anti-windup)
App.tsx	Dashboard UI, requestAnimationFrame telemetry loop, scenario presets, control state
ReactorMesh.tsx	3D vessel (Three.js cylinder + dome caps), animated agitator, particle-based flow visualization, live thermal color interpolation
TelemetryChart.tsx	Canvas-based rolling time-series chart of Ca and T
PhasePortraitChart.tsx	Canvas-based Ca-vs-T phase plane trajectory plot
Performance Notes
The physics engine uses pre-allocated Float64Array buffers for all the RK4 intermediate calculations (k1–k4, scratch state, derivatives), so the 60 FPS simulation loop doesn't allocate anything on the heap per frame. That avoids the garbage collection pauses that would otherwise cause visible stutter. The 3D particle system and both charts follow the same idea, using Float32Array/Float64Array ring buffers that get updated in place rather than creating new objects every frame.

Features
Live telemetry dashboard showing Ca, T, conversion %, and thermal state (NOMINAL / ELEVATED / RUNAWAY RISK), updating at 60 FPS.

Interactive cooling jacket control, a real-time slider for Tc that instantly shifts reactor thermodynamics.

Sustained disturbance toggles to inject a feed temperature fault (+40 K) or feed flow fault (+40 L/min), simulating upstream process upsets.

Closed-loop PI control, so you can switch from manual Tc control to an automatic controller that holds a target setpoint, complete with proper direction-aware anti-windup (more on that below).

Scenario presets: one-click Cold Start, Runaway Demo, and Disturbance Rejection Demo toggles for fast, repeatable demonstrations.

A 3D reactive vessel: a Three.js cylinder that smoothly shifts from blue (cold) to red (hot/exothermic runaway), with an animated agitator whose speed scales with temperature and a swirling particle field standing in for fluid circulation.

A transient response chart with a rolling 30-second time series of Ca and T.

A phase portrait: a Ca-vs-T trajectory plot that visually reveals the reactor's bistable operating curve.

Technical Challenge: Diagnosing a Controller Anti-Windup Bug
While building this, the PI controller kept getting permanently stuck at its minimum output limit (Tc = 250 K), even after the process temperature dropped below setpoint, a state where the controller should have been raising Tc, not holding it at maximum cooling.

The root cause was that the original anti-windup logic froze the integral term any time the output was saturated, without checking which direction the error was actually pushing it. Once the integral wound up deeply negative while the output was saturated low, it just stayed frozen even after the error flipped sign, because the freeze condition only asked "is the output currently out of bounds," not "is the current error making this worse or better."

The fix was direction-aware conditional integration. The integral only stops accumulating when the output is saturated and the current error would push it further into that same saturation direction. If the error is actually pulling the output back into range, integration carries on normally, which lets the controller recover cleanly. It's a pretty standard trick in industrial PID implementations, but it's easy to get subtly wrong, as this project proved firsthand.

Getting Started
bash
npm install
npm run dev
Open the printed local URL (usually http://localhost:5173) in your browser.

Dependencies
three, @react-three/fiber, @react-three/drei for 3D rendering.

No external charting or state management libraries. The telemetry charts and the physics engine are built from scratch using the HTML Canvas API and pre-allocated typed arrays.

Possible Extensions
Export telemetry history as CSV for offline analysis in MATLAB or Python.

Multi-reactant reaction network (Van de Vusse kinetics, for example).

Cascade control, with a secondary flow loop feeding into the temperature loop.

Visual HAZOP-style hazard overlays, like flagging lethal-service piping in red based on toxicity classification, closer to how a real consulting-grade digital twin would actually get used.

WebSocket-based multi-user shared simulation state.

License
MIT