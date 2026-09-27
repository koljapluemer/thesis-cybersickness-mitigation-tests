# Pose kinematics vs. optical flow

Offline analysis that derives rig and head motion directly from the logged poses
and measures how far the live optical flow measurement agrees with it. It runs as
part of `analysis/replay_session.py` (see `optical-flow.md`) and needs nothing
beyond what the session log already contains: `rigMatrixWorld` and each view's
`matrixWorld` for every frame.

Code in `analysis/`:

| File | Role |
|---|---|
| `kinematics.py` | Per-frame rig and head kinematics from the poses, `kinematics.png`. |
| `agreement.py` | Generic statistics for two autocorrelated time series and their plots. Knows nothing about rigs or flow. |
| `pose_flow.py` | Flow-side measures, the compared pairs and the output files. |
| `session_log.py` | Log loading shared by the scripts. |

## Kinematic measures

The rig is the camera's parent (the `tour-flight` entity in Mountain Flight, the
seat inside the car in Car Race, see `scenes.md`). The head is the camera
relative to the rig: `rig⁻¹ · camera`. Both eyes share the head's orientation, so
the first view stands for the head.

Rates are taken between consecutive frames over the frame's `deltaMs`. This is
the same discretisation as the optical flow, so both describe exactly the same
interval. A frame with no directly preceding frame, or one the rig teleported
into (`rig-teleport` event, e.g. a car reset), gets NaN.

Signs: yaw positive = **left** (counter-clockwise seen from above), pitch
positive = **up**. A leftward turn moves the image rightward, which is positive
in the flow's horizontal channel. Matching pairs therefore have the same sign.

| Measure | Definition |
|---|---|
| `rigYawRate` | change of the heading of the rig's forward axis (−z) projected onto the horizontal plane, about **world** up, °/s |
| `rigPitchRate` | change of the elevation of the rig's forward axis, °/s |
| `rigAngularSpeed` | angle of the rig's rotation between frames, any axis, °/s |
| `rigSpeed` | rig translation per frame, m/s (scene units) |
| `rigAcceleration` | magnitude of the change of the rig's velocity vector (speed and direction), m/s² |
| `headYaw`, `headPitch` | head orientation in the rig frame (0 = looking along the rig's forward axis), ° |
| `headYawRate` | change of `headYaw`, °/s |
| `headAngularSpeed` | angle of the head-in-rig rotation between frames, °/s |

In Mountain Flight the rig is pitched down by `tour-flight`'s `pitch` (30°), so
the rig's forward axis points 30° below the direction of travel. That offset is
constant and does not affect the heading. The car's rig is level.

## Compared pairs

Each pair has a pose-derived **reference** x and a flow **measure** y from the
live combined (mean over views) measurement:

| Pair | Reference | Measure | Same units |
|---|---|---|---|
| `rig-yaw-lateral-flow` | `rigYawRate` | rig-induced horizontal flow, mean of the left and right view half | yes |
| `rig-yaw-shared-lateral-flow` | `rigYawRate` | rig-induced lateral flow both halves share (smaller one if same sign, else 0) | yes |
| `head-yaw-head-lateral-flow` | `headYawRate` | total minus rig-induced horizontal flow, mean of halves | yes |
| `rig-angular-speed-mean-flow` | `rigAngularSpeed` | rig-induced mean flow speed | no: flow speed also contains translation, so only association is meaningful |

A pair whose reference or measure does not vary (spread < 1e-6) is skipped. For
example, a desktop session without mouse drag has no head motion.

**Expectations.** The flow is measured in eye space, but `rigYawRate` is about
world up. With the eye pitched down by θ, a world-up yaw ω appears as ω·cos θ
about the eye's up axis plus ω·sin θ of roll. At θ = 30° this alone predicts a
calibration slope of about 0.87 against lateral flow. Roll does not change
azimuth at the view centre, but it does off-centre, and translation adds
depth-dependent lateral flow. So the slope is not expected to be exactly 1.

## Preprocessing

Frame times are irregular. Every signal is linearly interpolated onto a uniform
grid at the median frame rate, within contiguous runs of frames where all
signals are present. A NaN in any signal splits the recording, for example an
unmeasured frame after entering or leaving VR. Runs shorter than 2 s are
dropped. All statistics respect these segments: lagged pairs, bootstrap blocks
and rolling windows never cross a segment boundary.

## Statistics

All in `agreement.json` (per pair) and `agreement-<pair>.png`. They are computed
at lag 0: reference and measure come from the same frame's poses, so they are
synchronous by construction.

- **Pearson r / Spearman ρ.** Association: do they move together? Pearson is
  linear, Spearman is monotone (ranks). Neither says the values are the *same*:
  a measure that is always half the reference still has r = 1.
- **Lin's concordance correlation coefficient (CCC)** (same units only).
  `2·cov / (var x + var y + (mean x − mean y)²)`. It is 1 only when all points
  lie on the identity line, so it penalises scale and offset differences as
  well as scatter. This is the headline number for "how much are they the same".
- **Bland–Altman** (same units only). Difference y − x plotted against the
  mean of both.
  - `bias`: mean difference.
  - `limitsOfAgreement`: bias ± 1.96 SD, the range that contains 95% of
    single-frame differences.
  - A slanted cloud means the disagreement grows with turn rate, i.e. a scale
    error.
- **Calibration line.** Ordinary least squares of y on x. `calibrationSlope`
  and `calibrationIntercept` say how the measure maps onto the reference.
  `rmse` is the root mean square of y − x.
- **Cross-correlation function (CCF).** r as a function of lag within ±2 s.
  - `ccfPeakLagMs` is a diagnostic and should be 0.
  - A peak at the search limit (`ccfPeakAtSearchLimit`) means the association
    is too weak or too slow to locate a lag.
  - Side lobes come from periodic structure shared by both signals.
- **Effective sample size** (Bartlett). Consecutive frames are nearly
  identical, so thousands of frames are worth only a handful of independent
  observations. N_eff = N / (1 + 2 Σₖ ρₓ(k) ρᵧ(k)), summed until the product
  of the two autocorrelations first drops to 0. `pearsonPValue` uses a t-test
  with N_eff − 2 degrees of freedom.
- **Moving block bootstrap.** Gives the 95% CIs of every statistic, with 1000
  replicates.
  - Blocks are as long as the slower of the two signals takes to decorrelate
    (autocorrelation < 1/e, `bootstrapBlockSec`), so resampled data keeps the
    serial dependence.
  - `bootstrapBlocksPerSession` says how many independent blocks the session
    contains. Below about 10, the CIs are unreliable.
- **Magnitude-squared coherence.** Welch, 8 s windows, spectra pooled over
  segments. It measures agreement per frequency on a scale of 0–1.
  `coherenceBands` holds band means for < 0.2 Hz (slow turns), 0.2–1 Hz and
  1–5 Hz. Coherence is unreliable where both signals carry little power, which
  shows as dips between the frequencies where the signals actually vary.
- **Rolling correlation.** Pearson r in a centred 5 s window. It shows where
  in the session the agreement breaks down. It is unstable where the reference
  is nearly constant within the window: with no variance, r is undefined.
- **Residual regression** (same units only). Exploratory. It fits y − x on:
  - x (a constant scale error, equal to calibration slope − 1)
  - each covariate z, standardised (an offset that depends on z)
  - each x·z (a scale error that depends on z)

  The covariates are coverage, head pitch, |head yaw|, rig speed and rig pitch
  rate for the rig pairs, and coverage, head pitch and rig angular speed for
  the head pair. Covariates without variation are dropped. It reports R² and
  coefficients with bootstrap CIs. The model is linear and the covariates are
  correlated with each other, so read the coefficients as hints, not as causes.

`agreement-summary.png` shows Pearson r, Spearman ρ and CCC with CIs for all
pairs.

## Outputs

In the replay output directory:

- `kinematics.png`: rig rotation rates, rig speed and acceleration, head
  orientation in the rig, and head rotation rates over the session.
- `agreement-<pair>.png`, one per pair that was not skipped:
  - time series of both signals and their difference
  - scatter with identity and calibration lines
  - Bland–Altman plot with CI bands
  - CCF
  - coherence
  - rolling correlation
  - residual regression coefficients
- `agreement-summary.png`
- `agreement.json`

## First results

Two desktop sessions (log format 3), no head motion:

| Session | Duration | Pair | r | CCC | Slope | Bias (°/s) | N_eff |
|---|---|---|---|---|---|---|---|
| 07-17-01 | 35 s | rig yaw ↔ lateral flow | 0.98 | 0.94 | 0.72 | 0.6 | 13 |
| 07-17-01 | 35 s | rig yaw ↔ shared lateral flow | 0.96 | 0.77 | 0.53 | 2.5 | 15 |
| 07-17-01 | 35 s | rig angular speed ↔ mean flow | 0.44 | – | – | – | 19 |
| 07-13-50 | 13 s | rig yaw ↔ lateral flow | 0.96 | 0.88 | 0.69 | 1.6 | 5 |

- The flow's lateral component tracks the rig yaw rate closely and with no lag
  (CCF peak at 0 ms).
- It underestimates the yaw rate by more than the pitch geometry alone predicts
  (slope 0.69–0.72 vs. cos 30° ≈ 0.87).
- The shared lateral flow scales down further, because it takes the smaller of
  the two halves.
- Mean flow speed is only moderately associated with rig rotation, because
  translation dominates it on straight stretches.
- These sessions are short: 4–18 bootstrap blocks, so the CIs are wide and
  only indicative. Sessions of several minutes are needed for firm numbers.

## Known limitations

- **Head pair untested on real head motion.** No log has any yet. It was
  checked only on a synthetic log, where a sinusoidal head yaw was injected
  into the poses and its rate added to the total flow. That gave CCC 0.9999
  and slope 1.0, which confirms the code path and the sign conventions.
- **Path ripple.** `tour-path.json` has keyframes every 0.2 s. Rig
  acceleration, yaw rate and flow all show the resulting ~5 Hz ripple. This is
  a property of the path, not measurement noise.
- **One session at a time.** Pooling sessions or participants needs
  repeated-measures Bland–Altman or mixed-effects models, which are not
  implemented.
