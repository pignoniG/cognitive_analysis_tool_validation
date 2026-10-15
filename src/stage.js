// The stimulus, drawn with three.js for both the monitor and the headset.
//
// No shading and no tone mapping, so every pixel shows the requested sRGB value (as in the calibration presenter).
// Head-locked parts hang from the camera: the uniform field (a sphere around the eye), the target disc and the
// fixation point, both one unit in front of the eye, so a disc of angular diameter θ has radius tan(θ/2). The
// panorama of a natural scene is in the world, turned so its view direction is ahead when the scene starts.

import { FIXATION } from "./config.js";
import { rad } from "./geometry.js";
import { rngFrom } from "./rng.js";

/** The renderer settings both modes share. */
export function configureRenderer(THREE, renderer) {
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.sortObjects = true;
}

export function createStage(THREE, renderer, { scenes = {} } = {}) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, 1, 0.01, 200);
  scene.add(camera);
  const material = (extra = {}) => new THREE.MeshBasicMaterial({ toneMapped: false, depthTest: false, depthWrite: false, ...extra });
  const setColour = (mat, [r, g, b]) => mat.color.setRGB(r / 255, g / 255, b / 255, THREE.SRGBColorSpace);
  const layer = (mesh, order, parent) => { mesh.renderOrder = order; mesh.frustumCulled = false; parent.add(mesh); return mesh; };

  const fieldMat = material({ side: THREE.BackSide });
  const field = layer(new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), fieldMat), 0, camera);

  const panoGeo = new THREE.SphereGeometry(40, 128, 64);
  panoGeo.scale(-1, 1, 1);                      // seen from inside, not mirrored
  const panoMat = material();
  const pano = layer(new THREE.Mesh(panoGeo, panoMat), 1, scene);
  pano.visible = false;

  const targetMat = material();
  const target = layer(new THREE.Mesh(new THREE.CircleGeometry(1, 256), targetMat), 2, camera);
  target.position.z = -1;
  target.visible = false;

  const r0 = Math.tan(rad(FIXATION.diameter / 2)), r1 = Math.tan(rad(FIXATION.diameter / 2 + FIXATION.outline));
  const outlineMat = material(), dotMat = material();
  setColour(outlineMat, FIXATION.stroke);
  setColour(dotMat, FIXATION.fill);
  const outline = layer(new THREE.Mesh(new THREE.RingGeometry(r0, r1, 64), outlineMat), 3, camera);
  const dot = layer(new THREE.Mesh(new THREE.CircleGeometry(r0, 64), dotMat), 4, camera);
  outline.position.z = dot.position.z = -1;

  const textures = new Map();
  const textureFor = (id) => {
    if (!textures.has(id)) {
      const t = new THREE.Texture(scenes[id]?.image ?? placeholderPanorama(id));
      t.colorSpace = THREE.SRGBColorSpace;
      t.needsUpdate = true;
      textures.set(id, t);
    }
    return textures.get(id);
  };

  let current = null;
  return {
    scene, camera,
    /** Show `step`. `headYaw` (radians) turns a panorama so its view direction is straight ahead. */
    show(step, { headYaw = 0 } = {}) {
      if (step.scene) {
        if (current?.scene !== step.scene) {
          panoMat.map = textureFor(step.scene);
          panoMat.needsUpdate = true;
          pano.rotation.y = headYaw + rad(scenes[step.scene]?.yaw ?? 0);
        }
        pano.visible = true;
        field.visible = false;
      } else {
        setColour(fieldMat, step.field);
        renderer.setClearColor(fieldMat.color);
        field.visible = true;
        pano.visible = false;
      }
      target.visible = !!step.target;
      if (step.target) {
        setColour(targetMat, step.target.rgb);
        const r = Math.tan(rad(step.target.diameter / 2));
        target.scale.set(r, r, 1);
      }
      current = step;
    },
    /** Screen mode: a camera whose vertical field is the canvas's real angular height. */
    fitScreen(vfov, aspect) {
      camera.fov = vfov;
      camera.aspect = aspect;
      camera.updateProjectionMatrix();
    },
    dispose() {
      for (const t of textures.values()) t.dispose();
      scene.traverse((o) => { o.geometry?.dispose(); o.material?.dispose(); });
    },
  };
}

/** A stand-in panorama until the real ones are chosen: sky, ground and blocks, with a brightness of its own
 *  (seeded by the id), so the scene condition can be run and logged end to end. */
export function placeholderPanorama(id, w = 2048, h = 1024) {
  const rng = rngFrom(`placeholder/${id}`);
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const g = c.getContext("2d");
  const k = 0.15 + 0.85 * rng();               // overall brightness of this scene
  const tone = (v) => Math.round(255 * Math.min(1, v * k));
  const sky = g.createLinearGradient(0, 0, 0, h / 2);
  sky.addColorStop(0, `rgb(${tone(0.45)},${tone(0.6)},${tone(0.95)})`);
  sky.addColorStop(1, `rgb(${tone(0.85)},${tone(0.9)},${tone(1)})`);
  g.fillStyle = sky; g.fillRect(0, 0, w, h / 2);
  g.fillStyle = `rgb(${tone(0.35)},${tone(0.32)},${tone(0.25)})`; g.fillRect(0, h / 2, w, h / 2);
  for (let i = 0; i < 40; i++) {
    const bw = 40 + rng() * 200, bh = 30 + rng() * 260, v = 0.1 + 0.9 * rng();
    g.fillStyle = `rgb(${tone(v)},${tone(v * (0.8 + 0.2 * rng()))},${tone(v * (0.7 + 0.3 * rng()))})`;
    g.fillRect(rng() * w, h / 2 - bh, bw, bh);
  }
  return c;
}
