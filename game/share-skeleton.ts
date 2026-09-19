import * as T from 'three';

const equivalent = (a: T.Skeleton, b: T.Skeleton) =>
  a.bones.length === b.bones.length && a.boneInverses.length === b.boneInverses.length &&
  a.bones.every((bone, i) => bone === b.bones[i]) &&
  a.boneInverses.every((matrix, i) => matrix.equals(b.boneInverses[i]));

/** Call only on a freshly SkeletonUtils-cloned, exclusively owned subtree.
 * Share exact bone-reference/bind-inverse equivalents within this clone. Source assets
 * and other instances never participate. Replaced clone palettes are released now;
 * the returned canonical palettes remain owned by the caller until its final dispose.
 */
export function shareEquivalentSkeletons(clonedRoot: T.Object3D): Set<T.Skeleton> {
  const canonical = new Set<T.Skeleton>(), replacements = new Map<T.Skeleton, T.Skeleton>();
  clonedRoot.traverse(object => {
    if (!(object instanceof T.SkinnedMesh)) return;
    const original = object.skeleton;
    let shared = replacements.get(original);
    if (!shared) {
      shared = [...canonical].find(candidate => equivalent(candidate, original)) ?? original;
      canonical.add(shared); replacements.set(original, shared);
    }
    object.skeleton = shared;
  });
  for (const [original, shared] of replacements) if (original !== shared) original.dispose();
  return canonical;
}
