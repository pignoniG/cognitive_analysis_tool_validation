// The natural scenes in assets/scenes (made by tools/make_scenes.py from Poly Haven HDRIs, CC0), listed in
// manifest.json with their credits, exposure and view direction: for the headset an 8-bit equirectangular panorama,
// for the monitor a rectilinear crop of it (`flat`) at the view direction.

const BASE = new URL("../assets/scenes/", import.meta.url);

/** Load the manifest and every panorama; resolves to `{ manifest, scenes: { id: { image, yaw, fov, label } } }`. */
export async function loadScenes(ids, { flat = false } = {}) {
  const res = await fetch(new URL("manifest.json", BASE));
  if (!res.ok) throw new Error(`scenes/manifest.json: ${res.status}`);
  const manifest = await res.json();
  const byId = Object.fromEntries(manifest.scenes.map((s) => [s.id, s]));
  const scenes = {};
  await Promise.all(ids.map(async (id) => {
    const m = byId[id];
    if (!m) throw new Error(`scene "${id}" is not in the manifest`);
    const image = new Image();
    image.src = new URL(flat ? m.view.file : m.file, BASE).href;
    await image.decode();
    scenes[id] = { image, yaw: m.yaw, fov: flat ? m.view.fov_deg : null, label: m.label };
  }));
  return { manifest, scenes };
}

/** What session.json records about the scenes used. */
export function sceneInfo(manifest, ids) {
  const used = new Set(ids);
  return manifest.scenes.filter((s) => used.has(s.id)).map(({ id, label, source, author, licence, yaw, ev, mean_linear_y, clipped_fraction }) =>
    ({ id, label, source, author, licence, yaw_deg: yaw, exposure_ev: ev, mean_linear_y, clipped_fraction }));
}
