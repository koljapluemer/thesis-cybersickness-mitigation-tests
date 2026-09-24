import 'aframe';
import type { Component } from 'aframe';
import './style.css';

type TourPoint = {
  t: number;
  position: [number, number, number];
};

type TourPath = {
  duration: number;
  points: TourPoint[];
};

type TourFlightData = {
  src: string;
  scale: number;
  offset: {
    x: number;
    y: number;
    z: number;
  };
  rotationY: number;
  lookAhead: number;
  pitch: number;
};

type TourFlightComponent = Component<TourFlightData> & {
  duration: number;
  path: TourPoint[];
  pathLoaded: boolean;
  offsetVector: InstanceType<typeof AFRAME.THREE.Vector3>;
  worldPosition: InstanceType<typeof AFRAME.THREE.Vector3>;
  lookTarget: InstanceType<typeof AFRAME.THREE.Vector3>;
  rotationEuler: InstanceType<typeof AFRAME.THREE.Euler>;
};

function samplePath(path: TourPoint[], t: number): [number, number, number] {
  if (path.length === 0) {
    return [0, 0, 0];
  }

  if (t <= path[0].t) {
    return path[0].position;
  }

  const lastPoint = path[path.length - 1];

  if (t >= lastPoint.t) {
    return lastPoint.position;
  }

  for (let index = 0; index < path.length - 1; index += 1) {
    const current = path[index];
    const next = path[index + 1];

    if (t > next.t) {
      continue;
    }

    const span = next.t - current.t;
    const alpha = span === 0 ? 0 : (t - current.t) / span;

    return [
      current.position[0] + (next.position[0] - current.position[0]) * alpha,
      current.position[1] + (next.position[1] - current.position[1]) * alpha,
      current.position[2] + (next.position[2] - current.position[2]) * alpha,
    ];
  }

  return lastPoint.position;
}

function applyWorldTransform(
  component: TourFlightComponent,
  point: [number, number, number],
  target: InstanceType<typeof AFRAME.THREE.Vector3>,
): void {
  target.set(point[0], point[1], point[2]);
  target.multiplyScalar(component.data.scale);
  target.applyEuler(component.rotationEuler);
  target.add(component.offsetVector.set(
    component.data.offset.x,
    component.data.offset.y,
    component.data.offset.z,
  ));
}

async function loadTourPath(component: TourFlightComponent): Promise<void> {
  const response = await fetch(component.data.src);

  if (!response.ok) {
    throw new Error(`Failed to load tour path from ${component.data.src}.`);
  }

  const tourPath = (await response.json()) as TourPath;

  component.path = tourPath.points;
  component.duration = tourPath.duration;
  component.pathLoaded = component.path.length > 1 && component.duration > 0;
}

AFRAME.registerComponent('tour-flight', {
  schema: {
    src: { type: 'string', default: '/tour-path.json' },
    scale: { type: 'number', default: 220 },
    offset: { type: 'vec3', default: { x: 0, y: 2.7, z: 0 } },
    rotationY: { type: 'number', default: 18 },
    lookAhead: { type: 'number', default: 1.2 },
    pitch: { type: 'number', default: 30 },
  },

  init(this: TourFlightComponent) {
    this.duration = 0;
    this.path = [];
    this.pathLoaded = false;
    this.offsetVector = new AFRAME.THREE.Vector3();
    this.worldPosition = new AFRAME.THREE.Vector3();
    this.lookTarget = new AFRAME.THREE.Vector3();
    this.rotationEuler = new AFRAME.THREE.Euler(0, 0, 0, 'YXZ');
    this.rotationEuler.set(0, AFRAME.THREE.MathUtils.degToRad(this.data.rotationY), 0);

    void loadTourPath(this).catch((error: unknown) => {
      console.error(error);
    });
  },

  update(this: TourFlightComponent) {
    this.rotationEuler.set(0, AFRAME.THREE.MathUtils.degToRad(this.data.rotationY), 0);
  },

  tick(this: TourFlightComponent, time: number) {
    if (!this.pathLoaded) {
      return;
    }

    const elapsedSeconds = (time / 1000) % this.duration;
    const currentPoint = samplePath(this.path, elapsedSeconds);
    const lookAheadPoint = samplePath(this.path, (elapsedSeconds + this.data.lookAhead) % this.duration);

    applyWorldTransform(this, currentPoint, this.worldPosition);
    applyWorldTransform(this, lookAheadPoint, this.lookTarget);

    this.el.object3D.position.copy(this.worldPosition);
    this.el.object3D.lookAt(this.lookTarget);
    this.el.object3D.rotateY(Math.PI);
    this.el.object3D.rotateX(-AFRAME.THREE.MathUtils.degToRad(this.data.pitch));
  },
});

const app = document.querySelector<HTMLDivElement>('#app');

if (!app) {
  throw new Error('App root not found.');
}

app.innerHTML = `
  <a-scene
    embedded
    renderer="antialias: true; colorManagement: true"
    background="color: #dcecf8"
    vr-mode-ui="enabled: true"
  >
    <a-assets>
      <a-asset-item id="mountain-landscape" src="/mountains/scene.gltf"></a-asset-item>
    </a-assets>

    <a-entity light="type: ambient; intensity: 0.8; color: #eef6ff"></a-entity>
    <a-entity
      light="type: directional; intensity: 1.2; color: #fff5df"
      position="6 10 3"
    ></a-entity>
    <a-sky color="#dcecf8"></a-sky>

    <a-entity
      gltf-model="#mountain-landscape"
      position="0 2.7 0"
      scale="220 220 220"
      rotation="0 18 0"
    ></a-entity>

    <a-entity tour-flight="src: /tour-path.json; scale: 220; offset: 0 2.7 0; rotationY: 18; pitch: 30">
      <a-camera
        fov="60"
        position="0 0 0"
        look-controls-enabled="false"
        wasd-controls-enabled="false"
      ></a-camera>
    </a-entity>
  </a-scene>
`;
