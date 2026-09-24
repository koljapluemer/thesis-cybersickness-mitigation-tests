import 'aframe';
import type { Matrix4, RawShaderMaterial } from 'three';

const THREE = AFRAME.THREE;

/**
 * Renders the per-pixel flow fields into two color attachments: attachment 0 is
 * the total flow, attachment 1 the rig-induced flow (see `FlowField` for the
 * channel layout, which both share).
 *
 * The CPU passes, per view, the transforms that map a point from the current
 * eye space into the previous eye space (`uToPrevEye`) and into the previous
 * eye space the eye would have had if only the rig had moved (`uToRigPrevEye`).
 * Both are close to identity, which keeps the float32 math well conditioned.
 */
const vertexShader = /* glsl */ `
precision highp float;

in vec3 position;

uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform mat4 uToPrevEye;
uniform mat4 uToRigPrevEye;

out vec3 vEye;
out vec3 vPrevEye;
out vec3 vRigPrevEye;

void main() {
  vec4 eye = modelViewMatrix * vec4(position, 1.0);
  vEye = eye.xyz;
  vPrevEye = (uToPrevEye * eye).xyz;
  vRigPrevEye = (uToRigPrevEye * eye).xyz;
  gl_Position = projectionMatrix * eye;
}
`;

const fragmentShader = /* glsl */ `
precision highp float;

uniform mat4 projectionMatrix;
uniform float uInvDeltaSec;

in vec3 vEye;
in vec3 vPrevEye;
in vec3 vRigPrevEye;

layout(location = 0) out vec4 outTotal;
layout(location = 1) out vec4 outRig;

float angleDeg(vec3 a, vec3 b) {
  return degrees(atan(length(cross(a, b)), dot(a, b)));
}

// Signed change of eye-space azimuth from prev to current, positive = rightward.
// Uses (forward, right) = (-z, x); atan of cross and dot is accurate for small angles.
float azimuthChangeDeg(vec3 prev, vec3 current) {
  vec2 p = vec2(-prev.z, prev.x);
  vec2 c = vec2(-current.z, current.x);
  return degrees(atan(p.x * c.y - p.y * c.x, dot(p, c)));
}

vec4 flow(vec3 prevEye, vec4 clipCurrent, vec3 current) {
  vec4 clipPrev = projectionMatrix * vec4(prevEye, 1.0);
  vec2 ndcFlow = clipPrev.w > 0.0
    ? clipCurrent.xy / clipCurrent.w - clipPrev.xy / clipPrev.w
    : vec2(0.0);

  return vec4(
    ndcFlow,
    angleDeg(normalize(prevEye), current),
    azimuthChangeDeg(prevEye, vEye)
  ) * uInvDeltaSec;
}

void main() {
  vec3 current = normalize(vEye);
  vec4 clipCurrent = projectionMatrix * vec4(vEye, 1.0);

  outTotal = flow(vPrevEye, clipCurrent, current);
  outRig = flow(vRigPrevEye, clipCurrent, current);
}
`;

export type FlowMaterial = RawShaderMaterial & {
  uniforms: {
    uToPrevEye: { value: Matrix4 };
    uToRigPrevEye: { value: Matrix4 };
    uInvDeltaSec: { value: number };
  };
};

export function createFlowMaterial(): FlowMaterial {
  return new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader,
    fragmentShader,
    side: THREE.DoubleSide,
    blending: THREE.NoBlending,
    uniforms: {
      uToPrevEye: { value: new THREE.Matrix4() },
      uToRigPrevEye: { value: new THREE.Matrix4() },
      uInvDeltaSec: { value: 0 },
    },
  }) as FlowMaterial;
}
