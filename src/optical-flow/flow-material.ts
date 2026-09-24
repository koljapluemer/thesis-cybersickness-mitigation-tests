import 'aframe';
import type { Matrix4, RawShaderMaterial } from 'three';

const THREE = AFRAME.THREE;

/**
 * Renders the per-pixel flow field (see `FlowField` for the channel layout).
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

out vec4 outFlow;

float angleDeg(vec3 a, vec3 b) {
  return degrees(atan(length(cross(a, b)), dot(a, b)));
}

void main() {
  vec3 current = normalize(vEye);
  vec4 clipCurrent = projectionMatrix * vec4(vEye, 1.0);
  vec4 clipPrev = projectionMatrix * vec4(vPrevEye, 1.0);
  vec2 ndcFlow = clipPrev.w > 0.0
    ? clipCurrent.xy / clipCurrent.w - clipPrev.xy / clipPrev.w
    : vec2(0.0);

  outFlow = vec4(
    ndcFlow * uInvDeltaSec,
    angleDeg(normalize(vPrevEye), current) * uInvDeltaSec,
    angleDeg(normalize(vRigPrevEye), current) * uInvDeltaSec
  );
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
