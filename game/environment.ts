import * as T from 'three';
import type { Art } from './scene';
import { BOXES } from './map';

/** Decorative geometry stays on roofs, against walls, or outside the play volume. */
export function buildPortDetails(a: Art) {
  const iron = a.mat('#343b3b', 0.72, 0.43),
    painted = a.mat('#c2bca8', 0.15, 0.65);
  const rust = a.mat('#766450', 0.45, 0.82),
    glass = a.mat('#506878', 0.45, 0.2);
  const rubber = a.mat('#1e2828', 0, 0.9),
    mortar = a.mat('#b6b1a1');
  const pipe = (from: number[], to: number[], r: number, material = iron) => {
    const f = new T.Vector3(...from),
      t = new T.Vector3(...to),
      delta = t.clone().sub(f);
    const geometry = new T.CylinderGeometry(r, r, delta.length(), 10, 1);
    geometry.applyQuaternion(
      new T.Quaternion().setFromUnitVectors(
        new T.Vector3(0, 1, 0),
        delta.clone().normalize(),
      ),
    );
    geometry.translate(...f.add(t).multiplyScalar(0.5).toArray());
    if (!a.batches.has(material)) a.batches.set(material, []);
    a.batches.get(material)!.push(geometry);
  };
  for (const [index, b] of BOXES.filter(
    (b) => b.kind === 'building',
  ).entries()) {
    for (const sign of [-1, 1]) {
      const x = b.x + sign * (b.w / 2 + 0.07);
      // Window recesses, stone lintels, glazing and individual mullions.
      for (let z = b.z - b.d / 2 + 1; z < b.z + b.d / 2; z += 2.5) {
        a.staticBox(x, 3.8, z, 0.025, 1.2, 1.58, glass);
        for (const dz of [-0.86, 0, 0.86])
          a.staticBox(
            x + sign * 0.027,
            3.8,
            z + dz,
            0.05,
            1.48,
            0.035,
            painted,
          );
        for (const y of [3.1, 3.8, 4.5])
          a.staticBox(x + sign * 0.025, y, z, 0.055, 0.04, 1.77, painted);
        a.staticBox(x + sign * 0.04, 3.03, z, 0.18, 0.1, 1.98, mortar);
      }
      // Pilasters define structural bays; repeated under the material batch budget.
      for (let z = b.z - b.d / 2; z <= b.z + b.d / 2 + 0.1; z += b.d / 3) {
        a.staticBox(x, 2.65, z, 0.1, 5.3, 0.26, mortar);
        a.staticBox(x, 0.3, z, 0.16, 0.6, 0.38, mortar);
      }
      const z = b.z - b.d / 2 + 0.22;
      pipe([x + sign * 0.1, 0.16, z], [x + sign * 0.1, 5.86, z], 0.055, rust);
      pipe([x, 5.8, b.z - b.d / 2], [x, 5.8, b.z + b.d / 2], 0.075, painted);
      for (const y of [0.6, 2.3, 4.8])
        a.staticBox(x + sign * 0.12, y, z, 0.05, 0.065, 0.17, iron);
      const boxZ = b.z + b.d / 2 - 0.65;
      a.staticBox(x + sign * 0.045, 1.65, boxZ, 0.15, 0.65, 0.48, painted);
      a.staticBox(x + sign * 0.13, 1.65, boxZ, 0.035, 0.55, 0.38, iron);
      pipe(
        [x + sign * 0.08, 0.2, boxZ],
        [x + sign * 0.08, 1.4, boxZ],
        0.018,
        iron,
      );
      a.staticBox(x + sign * 0.08, 4.94, b.z, 0.35, 0.68, 1.45, painted);
      for (let i = 0; i < 9; i++)
        a.staticBox(
          x + sign * 0.27,
          4.68 + i * 0.058,
          b.z,
          0.025,
          0.018,
          1.3,
          iron,
        );
    }
    for (const sign of [-1, 1]) {
      const z = b.z + sign * (b.d / 2 + 0.055);
      a.staticBox(b.x, 1.5, z, 2.34, 3, 0.08, iron);
      for (let y = 0.1; y < 2.95; y += 0.105)
        a.staticBox(b.x, y, z + sign * 0.045, 2.14, 0.068, 0.025, painted);
      for (const dx of [-1.19, 1.19])
        a.staticBox(b.x + dx, 1.52, z, 0.1, 3.16, 0.14, mortar);
      a.staticBox(b.x, 3.08, z, 2.6, 0.12, 0.18, mortar);
      a.label(
        `WAREHOUSE ${String(index + 1).padStart(2, '0')}`,
        b.x,
        5.15,
        z + sign * 0.06,
        2.3,
        0.36,
        sign > 0 ? 0 : Math.PI,
        '#343e40',
        '#d7ccb0',
      );
      a.staticBox(b.x, 3.5, z + sign * 0.18, 0.5, 0.11, 0.36, iron);
      a.staticBox(b.x, 3.45, z + sign * 0.18, 0.38, 0.02, 0.24, painted);
    }
    // Roof extractors, ribbing, chimney caps and service rails.
    for (const z of [b.z - b.d * 0.27, b.z + b.d * 0.27]) {
      a.staticBox(b.x, 6.37, z, 1.2, 0.54, 0.95, iron);
      for (let i = 0; i < 7; i++)
        a.staticBox(b.x - 0.51 + i * 0.17, 6.67, z, 0.06, 0.04, 0.92, painted);
      pipe([b.x, 6.25, z], [b.x, 7.35, z], 0.18, rust);
      a.staticBox(b.x, 7.37, z, 0.53, 0.08, 0.53, iron);
    }
  }
  // Drainage and restrained surface wear break up the repeating asphalt.
  for (const z of [-24, 0, 24])
    for (const x of [-7.1, 7.7]) {
      a.staticBox(x, 0.012, z, 0.48, 0.016, 1.6, iron);
      for (let i = 0; i < 14; i++)
        a.staticBox(
          x,
          0.024,
          z - 0.74 + i * 0.114,
          0.39,
          0.012,
          0.018,
          painted,
        );
    }
  const stain = a.texture((c) => {
    c.clearRect(0, 0, 256, 256);
    const g = c.createRadialGradient(128, 128, 15, 128, 128, 122);
    g.addColorStop(0, 'rgba(17,20,17,.31)');
    g.addColorStop(0.65, 'rgba(21,25,22,.16)');
    g.addColorStop(1, 'rgba(21,25,22,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, 256, 256);
  });
  const oil = new T.MeshStandardMaterial({
    map: stain,
    transparent: true,
    depthWrite: false,
    roughness: 0.24,
    metalness: 0.12,
  });
  a.materials.push(oil);
  for (const [x, z, s] of [
    [-5, 17, 2.3],
    [5, -17, 1.4],
    [-19, 4, 1.8],
    [21, -6, 2.2],
    [5, 2, 1.6],
  ]) {
    const patch = a.mesh(new T.PlaneGeometry(s, s * 0.53), oil, x, 0.018, z);
    patch.rotation.x = -Math.PI / 2;
    patch.rotation.z = x * 0.73;
    patch.castShadow = false;
  }
  // Fence and horizon silhouettes make the arena part of a working harbour.
  const meshTex = a.texture((c) => {
    c.clearRect(0, 0, 256, 256);
    c.strokeStyle = '#555d58';
    c.lineWidth = 2.5;
    for (let i = -256; i <= 512; i += 32) {
      c.beginPath();
      c.moveTo(i, 0);
      c.lineTo(i + 256, 256);
      c.stroke();
      c.beginPath();
      c.moveTo(i, 0);
      c.lineTo(i - 256, 256);
      c.stroke();
    }
  });
  meshTex.wrapS = meshTex.wrapT = T.RepeatWrapping;
  meshTex.repeat.set(24, 1);
  const fence = new T.MeshStandardMaterial({
    map: meshTex,
    transparent: true,
    alphaTest: 0.2,
    side: T.DoubleSide,
    roughness: 0.6,
    metalness: 0.6,
  });
  a.materials.push(fence);
  for (const sign of [-1, 1]) {
    const front = a.mesh(
      new T.PlaneGeometry(64, 2.1),
      fence,
      0,
      3.95,
      sign * 32.1,
    );
    front.castShadow = false;
    const side = a.mesh(
      new T.PlaneGeometry(64, 2.1),
      fence,
      sign * 32.1,
      3.95,
      0,
    );
    side.rotation.y = Math.PI / 2;
    side.castShadow = false;
    for (let k = -31; k <= 31; k += 4) {
      pipe([k, 2.8, sign * 32.1], [k, 5.1, sign * 32.1], 0.035);
      pipe([sign * 32.1, 2.8, k], [sign * 32.1, 5.1, k], 0.035);
    }
    pipe([-32, 4.92, sign * 32.1], [32, 4.92, sign * 32.1], 0.027);
    pipe([sign * 32.1, 4.92, -32], [sign * 32.1, 4.92, 32], 0.027);
    // Catenary cable runs stay over the warehouse roof line.
    const points = [
      new T.Vector3(-30, 8.4, sign * 26),
      new T.Vector3(0, 6.8, sign * 26),
      new T.Vector3(30, 8.4, sign * 26),
    ];
    const cable = new T.TubeGeometry(
      new T.CatmullRomCurve3(points),
      40,
      0.014,
      5,
      false,
    );
    if (!a.batches.has(rubber)) a.batches.set(rubber, []);
    a.batches.get(rubber)!.push(cable);
  }
  // Water sits outside all collision boundaries, visible through the mesh fence.
  const water = a.mat('#4e7881', 0.55, 0.24);
  const sea = a.mesh(new T.PlaneGeometry(280, 200), water, 0, -0.9, 90);
  sea.rotation.x = -Math.PI / 2;
  sea.castShadow = false;
  for (const x of [-42, 42]) {
    for (const z of [-31, -21]) {
      pipe([x - 3, 0, z], [x, 29, -36], 0.21, rust);
      pipe([x + 3, 0, z], [x, 29, -36], 0.21, rust);
    }
    for (let z = -48; z < -22; z += 3) {
      pipe([x - 1, 28.4, z], [x + 1, 30, z + 3], 0.07, iron);
      pipe([x + 1, 28.4, z], [x - 1, 30, z + 3], 0.07, iron);
    }
    pipe([x, 28, -21], [x, 10, -21], 0.035);
    pipe([x, 28, -44], [x, 12, -44], 0.035);
  }
}
