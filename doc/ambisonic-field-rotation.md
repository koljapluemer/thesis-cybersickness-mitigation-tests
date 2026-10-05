# Ambisonic field rotation (idea, not implemented)

> **Status: design note only.** Nothing in this document exists in the code.
> The implemented inertial ambience ([inertial-ambience.md](inertial-ambience.md))
> rotates each point source individually and is mathematically equivalent for
> the Big Room's dry point sources. This note records an alternative for the
> case it would not cover.

## Idea

Render the whole auditory scene into one ambisonic sound field, rotate that
field by the inertial sphere's lag, and decode it to binaural once:

    sources ─► encoder (per source: direction in rig frame) ─┐
                                                             ├─► ambisonic bus (rig frame)
    recorded ambisonic beds (rig or world frame) ───────────┘
          └─► rotator: R = q_head⁻¹ · q_rig · L      (L: inertial lag, rig frame)
              └─► binaural decoder (virtual loudspeakers or SH-domain HRTFs) ─► ears

Head tracking and the inertial lag become one rotation of the field. The order
is encode → rotate → decode, with a single HRTF stage.

## When it would pay off

- **Recorded ambiences.** An ambisonic room tone (AmbiX, ACN/SN3D) has no point
  sources to move, and rotating the field is the only way to swing it.
- **Many sources.** One rotator and one decoder cost the same for 4 sources or
  40. Per-source HRTF panners scale linearly.
- **One cue for everything.** Every spatial sound, including reverb tails and
  diffuse noise, swings together.

For the Big Room's four dry point sources it brings nothing over the
implemented per-source rotation. It only adds spatial blur (low orders) and a
dependency.

## Libraries (Web Audio)

- **[JSAmbisonics](https://github.com/polarch/JSAmbisonics)** (npm
  `ambisonics`): `monoEncoder` (per source), `sceneRotator` (yaw/pitch/roll,
  `updateRotMtx()`), `binDecoder` (SOFA HRTFs via `HRIRloader_*`). Supports
  FOA and HOA (ACN/N3D or SN3D; FuMa up to 3rd order). It covers the whole
  pipeline above. The rotator takes Euler angles, so the rotation needs
  converting from a quaternion each frame.
- **[Omnitone](https://github.com/GoogleChrome/omnitone)**: FOA/HOA (2nd/3rd
  order) rotation (`setRotationMatrix3/4`) and binaural decoding with
  GainNodes and ConvolverNodes. It **decodes only** and has no encoder for
  point sources.
- **[Resonance Audio Web SDK](https://developers.google.cn/resonance-audio/develop/web/getting-started)**:
  point sources and room model to ambisonics (first order by default,
  `setAmbisonicOrder` up to 3), built on Omnitone. Its listener orientation
  could carry the combined rotation.

## Trade-offs and footguns

- **Order vs blur vs CPU.** First order (4 channels) is cheap but blurs
  sources noticeably; localization is worse than one HRTF `PannerNode` per
  source. Third order (16 channels) is much sharper but needs a 16 × 16
  block-diagonal rotation (84 nonzero gains) and 16 decoder convolutions. That
  is plausible on a Quest but has to be measured.
- **Different HRTFs per condition.** The decoder's HRTF set (e.g. a SOFA file)
  differs from Chromium's built-in IRCAM-derived set. If only the ambience
  conditions used the ambisonic path, the timbre and localization would differ
  between conditions for reasons unrelated to the lag. All conditions would
  then have to use the same path.
- **Rotation convention.** Libraries differ in axis order, sign and
  normalization (ACN/SN3D vs FuMa). Rotating the field by R is rotating the
  listener by R⁻¹, and the sign of L must survive that.
- **Update rate.** Rotation matrices set from the render loop are block-rate
  parameters. A fast-moving lag may step audibly unless the gains are smoothed.

## Rejected variant: re-spatializing the ear signals

The original idea was to render the binaural left/right signals, treat them as
two point sources at the ears, rotate those, and render them again. It was
rejected for these reasons:

- **The ears lie on one axis, so the rotation mostly vanishes.**
  - Pitch turns about the interaural axis and does nothing.
  - Yaw makes both sources less lateral by the same amount: the image narrows
    instead of shifting.
  - Roll moves the pair in elevation, the weakest cue.
- **Not the identity at rest.** A source at ±90° still reaches the far ear, so
  even zero lag adds crosstalk, a second ITD and comb filtering. The condition
  would differ from the control whenever the rig is not accelerating.
- **Double HRTF.** The ear signals already contain pinna and head-shadow
  filtering, and a second HRTF pass colours them again.
- **Two ear signals carry too little spatial information.** Motion-tracked
  binaural recording needs 8–16 microphones around the head for this reason.
