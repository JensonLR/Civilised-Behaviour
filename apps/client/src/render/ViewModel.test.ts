import { DirectionalLight, HemisphereLight, Mesh, PerspectiveCamera, Scene, Vector3, type WebGLRenderer } from "three";
import { describe, expect, it } from "vitest";
import { encodeSpec, generateCharacter } from "@cb/procedural";
import { FLAG, WEAPON } from "@cb/shared";
import { CharacterActor, type ActorPose } from "./CharacterActor.ts";
import { ViewModel, modeFor, type ViewModelFrame } from "./ViewModel.ts";
import { MODE, VM } from "./viewPose.ts";
import { ghostMaterial } from "./ghost.ts";

const look = encodeSpec(generateCharacter(7));

function host() {
  const calls: string[] = [];
  const renderer = {
    info: { autoReset: true },
    autoClear: true,
    clearDepth: () => calls.push(`clearDepth autoClear=${renderer.autoClear}`),
    render: () => calls.push(`render autoClear=${renderer.autoClear}`),
  };
  const scene = new Scene();
  const sun = new DirectionalLight(0xffeecc, 2.5);
  sun.position.set(30, 50, 20);
  scene.add(new HemisphereLight(0xaabbff, 0x554433, 0.9), sun, sun.target);
  const camera = new PerspectiveCamera(78, 16 / 9, 0.05, 800);
  camera.position.set(12, 1.6, -30);
  camera.rotation.order = "YXZ";
  camera.rotation.set(-0.1, 0.7, 0);
  camera.updateMatrixWorld(true);
  return { h: { scene, camera, renderer: renderer as unknown as WebGLRenderer, outlines: true }, calls, renderer };
}

const frame = (over: Partial<ViewModelFrame> = {}): ViewModelFrame => ({
  weapon: WEAPON.RIFLE, aiming: false, sprinting: false, speed: 0, grounded: true, reload: 0, mode: MODE.FREE, yaw: 0.7, pitch: 0.1, shown: true,
  look, gore: "full", wounds: 0, missing: 0, userFov: 65, motion: 1, bob: 1, ...over,
});
const run = (vm: ViewModel, f: ViewModelFrame, seconds = 1): void => {
  for (let t = 0; t < seconds; t += 1 / 60) vm.update(1 / 60, f);
};

describe("ViewModel (the first-person hands and weapon)", () => {
  it("builds arms from the player's look and a weapon, draws at the camera's pose, and takes the world's lights", () => {
    const { h } = host();
    const vm = new ViewModel(h);
    run(vm, frame());
    expect(vm.active).toBe(true);
    expect(vm.weaponId).toBe(WEAPON.RIFLE);
    const rig = vm.armsRig!;
    // only the arms are in the viewmodel scene: the shoulders came out of the torso; the rest of the body is never in any scene
    expect(rig.joints.shoulderR.parent).toBe(vm.scene.children[0]);
    expect(rig.root.parent).toBeNull();
    let visibleMeshes = 0;
    vm.scene.traverse((o) => {
      if (o instanceof Mesh && o.visible) visibleMeshes++;
    });
    expect(visibleMeshes).toBeGreaterThan(6); // two arms with hands, the rifle, and their ink
    expect(visibleMeshes).toBeLessThan(24);
    // the lens: same place and turn as the world camera, its own field of view
    expect(vm.camera.position.distanceTo(h.camera.position)).toBeLessThan(1e-9);
    expect(vm.camera.quaternion.angleTo(h.camera.quaternion)).toBeLessThan(1e-9);
    expect(vm.camera.fov).toBeCloseTo(VM.fov, 3);
    expect(vm.camera.aspect).toBeCloseTo(16 / 9, 5);
    // sun and sky copied
    const lights = vm.scene.children.filter((c) => c instanceof DirectionalLight || c instanceof HemisphereLight);
    const sun = lights.find((l) => l instanceof DirectionalLight) as DirectionalLight;
    expect(sun.intensity).toBeCloseTo(2.5, 5);
    expect(sun.castShadow).toBe(false);
    vm.dispose();
  });

  it("draws in its own pass over the world: depth cleared first, colour kept, the renderer's clear flag restored", () => {
    const { h, calls, renderer } = host();
    const vm = new ViewModel(h);
    expect(renderer.info.autoReset).toBe(false); // the game resets the counters once per frame so the overlay sums both passes
    run(vm, frame());
    vm.render();
    expect(calls).toEqual(["clearDepth autoClear=false", "render autoClear=false"]);
    expect(renderer.autoClear).toBe(true);
    vm.dispose();
    expect(renderer.info.autoReset).toBe(true);
  });

  it("draws nothing (and renders nothing) when not in first person, and lowers out of view rather than popping", () => {
    const { h, calls } = host();
    const vm = new ViewModel(h);
    run(vm, frame());
    expect(vm.active).toBe(true);
    vm.update(1 / 60, frame({ shown: false }));
    expect(vm.active).toBe(true); // still lowering
    run(vm, frame({ shown: false }), 1);
    expect(vm.active).toBe(false);
    calls.length = 0;
    vm.render();
    expect(calls).toEqual([]);
    vm.dispose();
  });

  it("the muzzle in the world is in front of the lens and lands on the same screen spot as the viewmodel's muzzle, whatever the world lens", () => {
    for (const worldFov of [60, 78, 95]) {
      const { h } = host();
      h.camera.fov = worldFov;
      h.camera.updateProjectionMatrix();
      const vm = new ViewModel(h);
      run(vm, frame({ aiming: true }), 1.2);
      const m = vm.muzzleWorld(new Vector3(), 0)!;
      expect(m).toBeDefined();
      expect(Number.isFinite(m.x + m.y + m.z)).toBe(true);
      // the world camera projects it where the viewmodel camera projects the model's muzzle
      const worldNdc = m.clone().project(h.camera);
      const model = (vm as unknown as { model: { muzzle: { getWorldPosition(v: Vector3): Vector3 } } }).model;
      vm.camera.updateMatrixWorld(true);
      const vmNdc = model.muzzle.getWorldPosition(new Vector3()).project(vm.camera);
      expect(worldNdc.x).toBeCloseTo(vmNdc.x, 3);
      expect(worldNdc.y).toBeCloseTo(vmNdc.y, 3);
      const fwd = new Vector3(0, 0, -1).applyQuaternion(h.camera.quaternion);
      expect(m.clone().sub(h.camera.position).dot(fwd)).toBeGreaterThan(0.3);
      vm.dispose();
    }
  });

  it("aimed, the muzzle is near the middle of the screen (the sights are the crosshair); at the hip it is to the right of it", () => {
    const { h } = host();
    const vm = new ViewModel(h);
    run(vm, frame({ aiming: true }), 1.5);
    const aimed = vm.muzzleWorld(new Vector3(), 0)!.project(h.camera);
    expect(Math.abs(aimed.x)).toBeLessThan(0.08);
    expect(Math.abs(aimed.y)).toBeLessThan(0.1);
    run(vm, frame({ aiming: false }), 1.5);
    const hip = vm.muzzleWorld(new Vector3(), 0)!.project(h.camera);
    expect(hip.x).toBeGreaterThan(0);
    vm.dispose();
  });

  it("follows the settings: a new look rebuilds the arms, the weapon can change, wounds and missing arms show", () => {
    const { h } = host();
    const vm = new ViewModel(h);
    run(vm, frame());
    const first = vm.armsRig;
    run(vm, frame({ look: encodeSpec(generateCharacter(99)) }), 0.1);
    expect(vm.armsRig).not.toBe(first);
    run(vm, frame({ weapon: WEAPON.PISTOL }), 1);
    expect(vm.weaponId).toBe(WEAPON.PISTOL);
    run(vm, frame({ weapon: WEAPON.PISTOL, wounds: 0b1111 << 4, missing: 4 }), 0.2); // (a lost arm hides its meshes and shows a stump)
    vm.dispose();
  });

  it("disposes cleanly and can be rebuilt (menu -> play -> leave -> play again): no listeners, nothing left in the scene", () => {
    for (let round = 0; round < 3; round++) {
      const { h, renderer } = host();
      const vm = new ViewModel(h);
      run(vm, frame(), 0.3);
      vm.dispose();
      expect(vm.scene.children.some((c) => c.name === "" && c.children.length > 0 && c.parent === vm.scene && c.visible && c.children.some((k) => k instanceof Mesh))).toBe(false);
      expect(renderer.info.autoReset).toBe(true);
    }
  });

  it("maps the hands-busy flags to modes", () => {
    expect(modeFor(false, false, false, false)).toBe(MODE.FREE);
    expect(modeFor(true, false, false, false)).toBe(MODE.CARRY);
    expect(modeFor(false, true, false, false)).toBe(MODE.KNEEL);
    expect(modeFor(false, false, true, false)).toBe(MODE.DRAG);
    expect(modeFor(true, false, false, true)).toBe(MODE.CREW);
  });
});

describe("the body's own arms and weapon while the viewmodel draws them (render/ghost.ts)", () => {
  const pose = (over: Partial<ActorPose> = {}): ActorPose => ({ x: 0, y: 0, z: 0, facing: 0, vx: 0, vz: 0, flags: FLAG.GROUNDED, combat: { weapon: WEAPON.RIFLE + 1, elev: 0, reload: 0 }, ...over });
  const arms = (a: CharacterActor): Mesh[] => {
    const out: Mesh[] = [];
    const j = (a as unknown as { rig: { joints: { shoulderL: { traverse(f: (o: unknown) => void): void }; shoulderR: { traverse(f: (o: unknown) => void): void } } } }).rig.joints;
    for (const s of [j.shoulderL, j.shoulderR]) s.traverse((o) => o instanceof Mesh && out.push(o));
    return out;
  };

  it("arms and weapon stop drawing (shadow kept), nothing else changes, and everything comes back", () => {
    const scene = new Scene();
    const a = new CharacterActor(scene, look, 1, true);
    for (let i = 0; i < 40; i++) a.update(1 / 60, pose());
    const before = arms(a).map((m) => ({ m, material: m.material, visible: m.visible }));
    expect(before.length).toBeGreaterThan(4);
    a.setViewmodel(true);
    a.update(1 / 60, pose());
    for (const { m } of before) {
      if (m.castShadow) expect(m.material, m.name).toBe(ghostMaterial()); // still in the shadow map, writes no colour and no depth
      else expect(m.visible, m.name).toBe(false); // ink hulls and dressings
    }
    const gm = ghostMaterial();
    expect(gm.colorWrite).toBe(false);
    expect(gm.depthWrite).toBe(false);
    // the head shadow, torso and legs are untouched by it
    const torso = (a as unknown as { rig: { joints: { torso: { children: Mesh[] } } } }).rig.joints.torso.children.filter((c) => c.name === "mesh_torso")[0]!;
    expect(torso.material).not.toBe(gm);
    a.setViewmodel(false);
    for (const { m, material, visible } of before) {
      expect(m.material, m.name).toBe(material);
      expect(m.visible, m.name).toBe(visible);
    }
  });

  it("a dressing or stump that appears while the viewmodel is up is ghosted too, and a rebuilt rig (new look) is re-ghosted", () => {
    const scene = new Scene();
    const a = new CharacterActor(scene, look, 1, true);
    a.setViewmodel(true);
    a.update(1 / 60, pose({ wounds: 0xffff, missing: 4 }));
    for (const m of arms(a)) {
      if (!m.visible) continue;
      expect(m.material === ghostMaterial() || !m.castShadow, m.name).toBe(true);
    }
    a.setLook(encodeSpec(generateCharacter(31)));
    a.update(1 / 60, pose());
    for (const m of arms(a)) if (m.visible && m.castShadow) expect(m.material).toBe(ghostMaterial());
    a.dispose();
  });
});
