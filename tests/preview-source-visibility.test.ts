import { describe, expect, it } from 'vitest';
import { BufferAttribute, BufferGeometry, Group, Mesh, MeshBasicMaterial } from 'three';
import { createSourceVisibilityPreview } from '../scripts/preview-source-visibility';

const front = { x: .0254, y: 0, z: 0 }, back = { x: -.0254, y: 0, z: 0 };
function data() {
  return { format: 'source-visibility-v1', sourceBspSha256: 'synthetic', metersPerSourceUnit: .0254,
    sourceBounds: [[-10, -10, -10], [10, 10, 10]], worldHeadNode: 0, worldFirstFace: 0, worldFaceCount: 3, faceCount: 3,
    planes: [[1, 0, 0, 0]], nodes: [{ plane: 0, children: [-1, -2], firstFace: 0, faceCount: 0 }],
    leaves: [{ cluster: 0, area: 1, firstLeafFace: 0, leafFaceCount: 1 }, { cluster: 1, area: 2, firstLeafFace: 1, leafFaceCount: 1 }],
    leafFaces: [0, 1], clusterCount: 2, pvsRows: ['AQ==', 'Ag=='], faceClusters: [[0], [1], []],
    staticProps: [{ id: 0, leafIds: [0] }, { id: 1, leafIds: [1] }, { id: 2, leafIds: [] }], alwaysVisibleFaceIds: [], alwaysVisiblePropIds: [] };
}
function mesh(): Mesh {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(Float32Array.from({ length: 27 }, (_, i) => i / 3), 3));
  geometry.setAttribute('normal', new BufferAttribute(new Float32Array(27).fill(.125), 3));
  geometry.setAttribute('uv', new BufferAttribute(Float32Array.from({ length: 18 }, (_, i) => i / 17), 2));
  geometry.setAttribute('uv2', new BufferAttribute(Float32Array.from([0, 0, 0, 0, 0, 0, 1, 0, 1, 0, 1, 0, 2, 0, 2, 0, 2, 0]), 2));
  // Front, back, reversed front, exact duplicate front, unknown-membership face.
  geometry.setIndex(new BufferAttribute(new Uint16Array([0, 1, 2, 3, 4, 5, 2, 1, 0, 0, 1, 2, 6, 7, 8]), 1));
  geometry.userData = { source: 'untouched' };
  return new Mesh(geometry, new MeshBasicMaterial());
}
function currentIndices(m: Mesh) { return [...m.geometry.index!.array].slice(0, m.geometry.drawRange.count); }
function prop(id: number) { const p = new Group(); p.name = `static_prop_${id}`; p.userData = { sourceModel: 'original.mdl' }; return p; }

describe('private Source PVS geometry adapter', () => {
  it('retains original triangle order, reversed winding and duplicates with identical attributes', () => {
    const m = mesh(), original = m.geometry, indexBytes = original.index!.array.slice(), material = m.material;
    const controller = createSourceVisibilityPreview({ world: m, data: data() });
    expect(controller.update(front).worldVisibleTriangles).toBe(4);
    expect(currentIndices(m)).toEqual([0, 1, 2, 2, 1, 0, 0, 1, 2, 6, 7, 8]);
    for (const name of Object.keys(original.attributes)) expect(m.geometry.getAttribute(name)).toBe(original.getAttribute(name));
    expect(m.geometry.userData).toBe(original.userData); expect(m.material).toBe(material);
    expect(original.index!.array).toEqual(indexBytes);
    expect(controller.update(back).worldVisibleTriangles).toBe(2);
    expect(currentIndices(m)).toEqual([3, 4, 5, 6, 7, 8]);
    controller.dispose(); expect(m.geometry).toBe(original); expect(original.index!.array).toEqual(indexBytes);
  });
  it('preserves material group membership and the original draw range', () => {
    const m = mesh(), original = m.geometry;
    m.material = [new MeshBasicMaterial(), new MeshBasicMaterial()];
    original.addGroup(0, 6, 1); original.addGroup(6, 9, 0); original.setDrawRange(3, 9);
    const controller = createSourceVisibilityPreview({ world: m, data: data() }); controller.update(front);
    expect(currentIndices(m)).toEqual([2, 1, 0, 0, 1, 2]);
    expect(m.geometry.groups).toEqual([{ start: 0, count: 6, materialIndex: 0 }]);
    controller.update(back); expect(currentIndices(m)).toEqual([3, 4, 5]);
    expect(m.geometry.groups).toEqual([{ start: 0, count: 3, materialIndex: 1 }]);
    controller.dispose(); expect(m.geometry.drawRange).toEqual({ start: 3, count: 9 });
  });
  it('keeps inconsistent and out-of-range face IDs as well as missing face attributes visible', () => {
    const m = mesh(), face = m.geometry.getAttribute('uv2'); face.setX(0, 9999); face.setX(3, 9999); face.setX(4, 9999); face.setX(5, 9999);
    const other = mesh(); other.geometry.deleteAttribute('uv2'); const original = other.geometry;
    const root = new Group(); root.add(m, other);
    const controller = createSourceVisibilityPreview({ world: root, data: data() });
    expect(controller.update(back).worldVisibleTriangles).toBe(5); expect(other.geometry).toBe(original); expect(other.visible).toBe(true);
  });
  it('maps complete prop anchors and keeps unknown or duplicate IDs conservative', () => {
    const props = new Group(), a = prop(0), b = prop(1), unknown = prop(9999), duplicate = prop(0), extra = prop(2);
    const child = mesh(); b.add(child); const original = child.geometry, matrix = b.matrix.toArray();
    props.add(a, b, unknown, duplicate, extra);
    const controller = createSourceVisibilityPreview({ world: mesh(), props, data: data() });
    const stats = controller.update(front); expect(stats.unknownPropAnchors).toBe(3); expect(stats.mappedProps).toBe(2);
    expect(b.visible).toBe(false); expect([a.visible, duplicate.visible, unknown.visible, extra.visible]).toEqual([true, true, true, true]);
    expect(child.geometry).toBe(original); expect(b.matrix.toArray()).toEqual(matrix);
    controller.update(back); expect(b.visible).toBe(true); controller.dispose(); expect(b.visible).toBe(true);
  });
  it('does no geometry update inside one cluster and restores complete geometry on a boundary or disabling', () => {
    const m = mesh(), original = m.geometry, controller = createSourceVisibilityPreview({ world: m, data: data() });
    expect(controller.update(front).changed).toBe(true); const version = m.geometry.index!.version;
    expect(controller.update({ ...front, x: .05 }).changed).toBe(false); expect(m.geometry.index!.version).toBe(version);
    expect(controller.update({ x: 0, y: 0, z: 0 }).allVisible).toBe(true); expect(m.geometry).toBe(original);
    controller.update(back); expect(m.geometry).not.toBe(original);
    expect(controller.update(back, false).allVisible).toBe(true); expect(m.geometry).toBe(original);
    controller.update(front); controller.dispose(); expect(m.geometry).toBe(original);
    controller.dispose(); expect(() => controller.update(front)).toThrow('disposed');
  });
  it('preserves originally hidden objects and falls back on malformed input', () => {
    const m = mesh(), p = prop(1), original = m.geometry; m.visible = false; p.visible = false;
    const controller = createSourceVisibilityPreview({ world: m, props: p, data: data() });
    controller.update(front); expect(m.visible).toBe(false); expect(p.visible).toBe(false);
    controller.update(back); expect(p.visible).toBe(false); controller.dispose(); expect(m.visible).toBe(false);
    const bad = createSourceVisibilityPreview({ world: m, props: p, data: {} });
    expect(bad.update(front).allVisible).toBe(true); expect(m.geometry).toBe(original); expect(p.visible).toBe(false);
  });
});

it('excludes separate sky geometry even on an all-visible fallback or with PVS disabled, then restores originals',()=>{
  const m=mesh(),original=m.geometry,props=new Group(),sky=prop(2),regular=prop(0);props.add(sky,regular);
  const faces=[2],ids=[2];
  const controller=createSourceVisibilityPreview({world:m,props,data:data(),excludeWorldFaceIds:faces,excludeStaticPropIds:ids});
  faces.length=0;ids.length=0;
  expect(controller.update(front).worldVisibleTriangles).toBe(3);expect(sky.visible).toBe(false);expect(regular.visible).toBe(true);
  const all=controller.update({x:0,y:0,z:0});expect(all.allVisible).toBe(true);expect(all.worldVisibleTriangles).toBe(4);
  expect(currentIndices(m)).toEqual([0,1,2,3,4,5,2,1,0,0,1,2]);expect(sky.visible).toBe(false);
  controller.update(back,false);expect(sky.visible).toBe(false);expect(m.geometry.index!.array.slice(0,12)).toEqual(new Uint16Array([0,1,2,3,4,5,2,1,0,0,1,2]));
  controller.dispose();expect(m.geometry).toBe(original);expect(sky.visible).toBe(true);
});
it('rejects unknown sky exclusion identities rather than silently failing to separate passes',()=>{
  expect(()=>createSourceVisibilityPreview({world:mesh(),data:data(),excludeWorldFaceIds:[999]})).toThrow('exclusion');
  expect(()=>createSourceVisibilityPreview({world:mesh(),data:data(),excludeStaticPropIds:[2]})).toThrow('exclusion');
});
