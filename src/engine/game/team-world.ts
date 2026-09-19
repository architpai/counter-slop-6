import * as THREE from 'three';
import { boxGeo, cylGeo, ringGeo, unlitMat, TONE, TONE_HEX } from '../render/index';
import type { Ctx, Level } from '../types';
import type { Team, TeamLayout, TeamMatch } from './team-rules';

/** Feet positions in world metres, independent of solo/FFA spawn markers. */
export function teamLayout(level: Level): TeamLayout {
  switch (level.key) {
    case 'downtown': return {
      neutral: [0, 0, 0], bases: [[-48, 0, 0], [48, 0, 0]],
      // Outside the two buildings, away from the highway stairs and perimeter walls.
      spawns: [
        [[-57, 0, -8], [-57, 0, -4], [-57, 0, 4], [-57, 0, 8]],
        [[57, 0, -8], [57, 0, -4], [57, 0, 4], [57, 0, 8]],
      ],
    };
    case 'house': return {
      // Front lawn: south of both basement openings; spawns also clear the scaffold.
      neutral: [0, 0, 23], bases: [[-24, 0, 23], [24, 0, 23]],
      spawns: [
        [[-18, 0, 36], [-20, 0, 36], [-22, 0, 36], [-24, 0, 36]],
        [[18, 0, 36], [20, 0, 36], [22, 0, 36], [24, 0, 36]],
      ],
    };
    case 'mexico': return {
      // Bases on sand; neutral on plaza paving, clear of the fountain and market.
      // Rear lanes reach the bases through the gaps between houses at z = 8.
      neutral: [0, 0.15, 12], bases: [[-28, 0, 10], [28, 0, 10]],
      spawns: [
        [[-50, 0, 2], [-50, 0, 6], [-50, 0, 10], [-50, 0, 14]],
        [[50, 0, 2], [50, 0, 6], [50, 0, 10], [50, 0, 14]],
      ],
    };
    default: throw new Error('Team matches require Downtown, House or Mexico.');
  }
}

/** Created only for a team match; owns cosmetics, never level geometry or colliders. */
export function createTeamWorld(ctx: Ctx): {
  update(state: TeamMatch, teams: Record<string, Team>, selfId: string): void;
  dispose(): void;
} {
  const layout = teamLayout(ctx.level), root = new THREE.Group();
  root.name = 'teamWorld';
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures: THREE.Texture[] = [];
  const colors = [TONE_HEX[TONE.HOSTILE], TONE_HEX[TONE.PRIMARY]] as const;
  const gold = TONE_HEX[TONE.ACCENT];
  const material = (color: number) => {
    const mat = unlitMat(color).clone(); // Never mutate/dispose a cached material.
    mat.fog = mat.toneMapped = false;
    materials.add(mat);
    return mat;
  };
  const red = material(colors[0]), blue = material(colors[1]);
  const neutralMat = material(gold), flagMat = material(gold);
  const dark = material(0x263640), white = material(0xffffff);
  const mesh = (parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0) => {
    const obj = new THREE.Mesh(geo, mat);
    obj.position.set(x, y, z);
    geometries.add(geo);
    parent.add(obj);
    return obj;
  };
  const label = (parent: THREE.Object3D, text: string, color: number, y: number) => {
    // makeNameTag has a fixed red background. Sprites keep both team labels distinct
    // and readable from above, below and either side without per-frame billboarding.
    const canvas = document.createElement('canvas');
    canvas.width = 512; canvas.height = 128;
    const paint = canvas.getContext('2d');
    if (!paint) throw new Error('teamWorld: no 2d canvas context');
    paint.fillStyle = '#263640'; paint.fillRect(0, 0, 512, 128);
    paint.fillStyle = `#${color.toString(16).padStart(6, '0')}`; paint.fillRect(0, 0, 16, 128);
    paint.fillStyle = '#ffffff'; paint.font = '700 48px "Space Grotesk", sans-serif';
    paint.textAlign = 'center'; paint.textBaseline = 'middle'; paint.fillText(text, 264, 64, 464);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.SpriteMaterial({ map: texture, fog: false, toneMapped: false, depthWrite: false });
    textures.push(texture); materials.add(mat);
    const sprite = new THREE.Sprite(mat);
    sprite.name = text; sprite.position.y = y; sprite.scale.set(4, 1, 1);
    parent.add(sprite);
    return sprite;
  };
  const marker = (name: string, point: TeamLayout['neutral'], radius: number, mat: THREE.MeshBasicMaterial) => {
    const group = new THREE.Group();
    group.name = name; group.position.fromArray(point); root.add(group);
    mesh(group, ringGeo(radius, 0.32, 64).rotateX(-Math.PI / 2), dark, 0, 0.075);
    mesh(group, ringGeo(radius, 0.18, 64).rotateX(-Math.PI / 2), mat, 0, 0.085);
    label(group, name, mat.color.getHex(), 1.1); // Clear of the flag's overhead label.
    return group;
  };
  marker('RED BASE', layout.bases[0], 2.5, red);
  marker('BLUE BASE', layout.bases[1], 2.5, blue);
  const neutral = marker('FLAG START', layout.neutral, 1.8, neutralMat);
  const flag = new THREE.Group();
  flag.name = 'teamFlag'; root.add(flag);
  mesh(flag, cylGeo(0.055, 2.8, 8, 'y'), white, 0, 1.4);
  const cloth = mesh(flag, boxGeo(1.6, 1, 0.08), flagMat, 0.8, 2.1);
  cloth.name = 'flagCloth';
  const restingLabel = label(flag, 'FLAG', gold, 3.5);
  const carrierLabel = label(flag, 'FLAG CARRIER', gold, 3.5);
  neutral.visible = flag.visible = false;
  ctx.scene.add(root);
  let disposed = false;
  return {
    update(state, teams, selfId) {
      if (disposed) return;
      neutral.visible = flag.visible = state.mode === 'flag' && state.breakLeft <= 0;
      const id = state.flag.carrier;
      const carrier = id === selfId ? ctx.player : id === null ? null : ctx.remotes.get(id);
      flag.position.fromArray(state.flag.pos);
      if (id !== null) {
        if (carrier?.alive) flag.position.copy(carrier.body.pos);
        flag.position.y += (carrier?.body.height ?? 1.75) + 0.35;
      }
      // The pole stays upright; the cloth presents its broad side to the viewer.
      flag.rotation.y = Math.atan2(ctx.camera.position.x - flag.position.x, ctx.camera.position.z - flag.position.z);
      const team = id === null ? state.flag.placed : teams[id];
      flagMat.color.set(team === 0 || team === 1 ? colors[team] : gold);
      restingLabel.visible = id === null; carrierLabel.visible = id !== null;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      root.removeFromParent();
      for (const geo of geometries) geo.dispose();
      for (const mat of materials) mat.dispose();
      for (const texture of textures) texture.dispose();
    },
  };
}
