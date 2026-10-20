import * as THREE from 'three';

/**
 * A figure root whose owner has just brought its tree up to date (enemies/model.ts `syncModel`): the renderer's
 * scene update that follows leaves that tree as it is (perf Round 6; kept in MSI round 2).
 *
 * three's `updateMatrixWorld` recomposes each node it reaches under a forced parent (the scene composes its own
 * matrix, so it always forces its children) and multiplies it by its parent's world matrix again. From the same
 * inputs that is the same products, so the same bits as the owner's update gave. While a root is fresh nothing
 * under it has changed since that update: no local transform written, no matrix or `matrixAutoUpdate` set, no
 * node added, moved or taken out. Every writer that can do one of these after the owner's update marks the root
 * stale first (`staleFigure`): the figure's weapon swap, shield drop, lend and dispose (render/figure.ts), an
 * operator put on or taken off (render/operators.ts, it moves the prop), a death pose, a badge or an arc added
 * (enemies). The root's own step stays three's, so a root or parent that moved since is still seen: its tree is
 * left only while its world matrix is bit-equal to the one the owner left. The worn operator's armature (posed by
 * the renderer after the step, render/operators.ts `frame`, and left out of the owner's update) is always walked as
 * three walks it. A root is fresh for one walk only: the next one, without another owner's update, is three's.
 */
interface Fresh {
  on: boolean;
  /** The root's world matrix as the owner's update left it. */
  readonly world: Float64Array;
  /** The figure's operator hooks: its armature, if it wears one. */
  readonly rig: { readonly armature: THREE.Object3D | null } | undefined;
}

const fresh = new WeakMap<THREE.Object3D, Fresh>();
const walk = THREE.Object3D.prototype.updateMatrixWorld;

/** three r170's `Object3D.updateMatrixWorld`, but a fresh root's tree (less its armature) is not walked again. */
function freshWalk(this: THREE.Object3D, force?: boolean): void {
  const state = fresh.get(this);
  if (!state?.on) {
    walk.call(this, force);
    return;
  }
  state.on = false;
  if (this.matrixAutoUpdate) this.updateMatrix();
  if (this.matrixWorldNeedsUpdate || force) {
    if (this.matrixWorldAutoUpdate) {
      if (this.parent === null) this.matrixWorld.copy(this.matrix);
      else this.matrixWorld.multiplyMatrices(this.parent.matrixWorld, this.matrix);
    }
    this.matrixWorldNeedsUpdate = false;
    force = true;
  }
  const m = this.matrixWorld.elements, w = state.world;
  let same = true;
  for (let i = 0; i < 16; i++) {
    if (!Object.is(m[i], w[i])) {
      same = false;
      break;
    }
  }
  const armature = state.rig?.armature ?? null, children = this.children;
  for (let i = 0, l = children.length; i < l; i++) {
    const child = children[i]!;
    if (!same || child === armature) child.updateMatrixWorld(force);
  }
}

/** The owner has just updated `root`'s whole tree, its armature aside: the next scene update can leave it. */
export function freshFigure(root: THREE.Object3D, rig?: { readonly armature: THREE.Object3D | null }): void {
  let state = fresh.get(root);
  if (!state) {
    fresh.set(root, state = { on: false, world: new Float64Array(16), rig });
    root.updateMatrixWorld = freshWalk;
  }
  state.world.set(root.matrixWorld.elements);
  state.on = true;
}

/** Something under `root` changes (or may have) since its owner's update: the next scene update walks it whole. */
export function staleFigure(root: THREE.Object3D): void {
  const state = fresh.get(root);
  if (state) state.on = false;
}
