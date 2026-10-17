import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { VISUAL } from "../src/config.js";

const dir = new URL("../assets/scenes/", import.meta.url);
const manifest = JSON.parse(readFileSync(new URL("manifest.json", dir), "utf8"));

test("every configured scene is in the manifest, with its image, source and licence", () => {
  for (const id of VISUAL.scenes.ids) {
    const s = manifest.scenes.find((m) => m.id === id);
    assert.ok(s, `scene ${id} missing from the manifest`);
    assert.ok(existsSync(new URL(s.file, dir)), `${s.file} missing`);
    assert.equal(s.licence, "CC0");
    assert.match(s.source, /^https:\/\/polyhaven\.com\/a\//);
    assert.deepEqual(s.size, [8192, 4096]);
    assert.ok(existsSync(new URL(s.view.file, dir)), `${s.view.file} missing`);
    assert.deepEqual(s.view.fov_deg, [90, 60]);
    assert.ok(s.view.pixels_per_degree >= 40, "the monitor's crop is about 1:1 on a 4K screen");
  }
});

test("the scenes span dark to bright by their set mean luminance, in the panorama and in the monitor's crop", () => {
  const m = VISUAL.scenes.ids.map((id) => manifest.scenes.find((s) => s.id === id).mean_linear_y);
  assert.deepEqual([...m].sort((a, b) => a - b), m, "ids are listed from dark to bright");
  assert.ok(m[m.length - 1] / m[0] >= 10);
  const v = VISUAL.scenes.ids.map((id) => manifest.scenes.find((s) => s.id === id).view.mean_linear_y);
  assert.deepEqual([...v].sort((a, b) => a - b), v);
  assert.ok(v[v.length - 1] / v[0] >= 10);
});
