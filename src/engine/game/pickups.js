import * as THREE from 'three';
import { rand, choose } from '../util.js';
import { surfMat, unlitMat, TONE, TONE_HEX } from '../render/index.js';

export function createPickups(ctx) {
  const items = [];
  let nextId = 1, arenaClock = 0;
  function spawn(kind, pos, id) {
    if (!['ammo', 'health'].includes(kind) || (id != null && items.some(p => p.id === id))) return null;
    const mesh = new THREE.Group();
    const add = (geometry, material, x = 0, y = 0, z = 0) => {
      const part = new THREE.Mesh(geometry, material);
      part.position.set(x, y, z); mesh.add(part);
    };
    if (kind === 'ammo') {
      add(new THREE.CylinderGeometry(0.23, 0.23, 0.5, 8), surfMat('metal'));
      add(new THREE.CylinderGeometry(0.17, 0.17, 0.07, 8), surfMat('dark'), 0, 0.285);
      add(new THREE.BoxGeometry(0.24, 0.2, 0.03), unlitMat(TONE_HEX[TONE.PRIMARY]), 0, 0, 0.22);
    } else if (ctx.level.key === 'mexico') {
      const shell = new THREE.CylinderGeometry(0.42, 0.42, 0.2, 8, 1, false, 0, Math.PI);
      shell.rotateX(Math.PI / 2);
      add(shell, surfMat('accent'));
      add(new THREE.BoxGeometry(0.65, 0.12, 0.16), surfMat('foliage'), 0, 0.08);
      add(new THREE.BoxGeometry(0.55, 0.08, 0.19), surfMat('hot'), 0, 0.13);
    } else {
      const mat = unlitMat(TONE_HEX[TONE.HEAL]);
      add(new THREE.BoxGeometry(0.6, 0.2, 0.2), mat);
      add(new THREE.BoxGeometry(0.2, 0.6, 0.2), mat);
    }
    mesh.position.copy(pos); mesh.position.y += 0.6;
    const p = { id: id ?? nextId++, kind, mesh, baseY: mesh.position.y, phase: rand(0, 6), life: 45 };
    nextId = Math.max(nextId, p.id + 1);
    items.push(p); ctx.scene.add(mesh);
    if (ctx.net.active && ctx.net.isHost && id == null) ctx.net.broadcast('pickup', { id: p.id, kind, pos: pos.toArray() });
    return p;
  }
  function remove(id) {
    const i = items.findIndex(p => p.id === id);
    if (i < 0) return false;
    const [p] = items.splice(i, 1); p.mesh.removeFromParent();
    p.mesh.traverse(o => o.geometry?.dispose());
    return true;
  }
  function collect(p) {
    const player = ctx.player;
    if (p.kind === 'ammo') {
      player.addAmmoAll(0.4); player.grenades = Math.min(player.maxGrenades, player.grenades + 1);
      ctx.hud.kill('+AMMO · +GRENADE');
    } else {
      player.heal(35); ctx.hud.kill(ctx.level.key === 'mexico' ? 'TACO · +35 HP' : '+35 HP');
    }
    ctx.audio.pickup(); ctx.effects.strokeBurst(p.mesh.position, p.kind === 'ammo' ? TONE.PRIMARY : TONE.HEAL, 12, 4, { life: 0.3 });
  }
  function update(dt) {
    for (let i = items.length - 1; i >= 0; i--) {
      const p = items[i]; p.phase += dt;
      p.mesh.position.y = p.baseY + 0.12 * Math.sin(2.5 * p.phase); p.mesh.rotation.y += 1.8 * dt;
      if (ctx.player.alive && p.mesh.position.distanceTo(ctx.player.center) < 1.5) {
        collect(p); remove(p.id);
        if (ctx.net.active) ctx.net.send(ctx.net.isHost ? 'taken' : 'take', { id: p.id });
      } else if (!ctx.net.active || ctx.net.isHost) {
        p.life -= dt;
        if (p.life <= 0) { remove(p.id); if (ctx.net.active) ctx.net.broadcast('taken', { id: p.id }); }
      }
    }
  }
  function arenaUpdate(dt) {
    if (!ctx.net.isHost || !ctx.net.active || !ctx.game.playing()) return;
    arenaClock -= dt;
    if (arenaClock <= 0 && items.length < 10 && ctx.level.pickups.length) {
      arenaClock = 7; spawn('ammo', choose(ctx.level.pickups));
    }
  }
  function clear() { while (items.length) remove(items.at(-1).id); arenaClock = 0; }
  return { items, spawn, remove, update, arenaUpdate, clear };
}
