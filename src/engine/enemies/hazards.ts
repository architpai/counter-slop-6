import { DoubleSide, Group, Mesh, MeshBasicMaterial, RingGeometry, SphereGeometry, BoxGeometry, Vector3 } from 'three';
import { rand } from '../util';
import type { NavGrid } from '../nav';
import type { World } from '../physics';
import type { Breakable, Target } from '../types';
import type { EnemyManager, EnemyRecord } from './index';

export const RING = { cap: 3, radius: 5, spacing: 8, playerDistance: 4, countdown: 3, life: 8 } as const;
export interface BanRing { pos: Vector3; age: number; owner: EnemyRecord; mesh: Mesh<RingGeometry, MeshBasicMaterial> }
interface Smoke { pos: Vector3; from: Vector3; destination: Vector3; age: number; mesh: Mesh<SphereGeometry, MeshBasicMaterial> }
interface Charge { prop: Breakable; target: Breakable; age: number }
const inRing = (p: { x: number; y: number; z: number }, c: Vector3, margin = 0) =>
  Math.abs(p.y - c.y) < 2.2 && Math.hypot(p.x - c.x, p.z - c.z) < RING.radius + margin;

/** A walkable escape must fit within the warning, without crossing an existing danger zone.
 * Conservative: pending rings count as active. Rejecting a cast is safer than trapping the player. */
export function hasRingEscape(nav: NavGrid, player: Target, centers: Vector3[], world: World): boolean {
  const start = nav.nearest(player.body.pos, 2, 3), first = nav.nodes[start];
  if (!first || Math.hypot(first.x - player.body.pos.x, first.z - player.body.pos.z) > 1.6
    || Math.abs(first.y - player.body.pos.y) > 2.2) return false;
  const clear = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) => !world.overlapsAABB(
    new Vector3(Math.min(a.x, b.x) - player.body.halfW, Math.max(a.y, b.y) + 0.05, Math.min(a.z, b.z) - player.body.halfW),
    new Vector3(Math.max(a.x, b.x) + player.body.halfW, Math.max(a.y, b.y) + player.body.height, Math.max(a.z, b.z) + player.body.halfW));
  if (!clear(player.body.pos, first)) return false;
  const initial = centers.filter(c => inRing(player.body.pos, c, player.body.halfW + 0.3));
  const blocked = (n: { x: number; y: number; z: number }) => centers.some(c =>
    !initial.includes(c) && inRing(n, c, player.body.halfW + 0.3));
  const queue: [number, number][] = [[start, 0]], seen = new Set([start]);
  for (let i = 0; i < queue.length; i++) {
    const [id, distance] = queue[i]!, node = nav.nodes[id]!;
    if (Math.hypot(node.x - player.body.pos.x, node.z - player.body.pos.z) >= 4
      && !centers.some(c => inRing(node, c, player.body.halfW + 0.8))) return true;
    for (const edge of node.links) {
      const next = nav.nodes[edge.to];
      if (!next || seen.has(edge.to) || edge.dy > 0.55 || edge.dy < -0.8
        || distance + edge.cost > 8 || blocked(next) || !clear(node, next)) continue;
      // Once outside a ring, never route back into it.
      if (initial.some(c => !inRing(node, c, player.body.halfW + 0.3) && inRing(next, c, player.body.halfW + 0.3))) continue;
      seen.add(edge.to); queue.push([edge.to, distance + edge.cost]);
    }
  }
  return false;
}

export class EnemyHazards {
  rings: BanRing[] = [];
  smoke: Smoke[] = [];
  charges: Charge[] = [];
  destroyedCover = 0;
  private damageT = 0;
  private damage = new Map<Target, { amount: number; from: Vector3 }>();
  constructor(private m: EnemyManager) {}

  placeRing(owner: EnemyRecord): boolean {
    if (this.rings.length >= RING.cap || !owner.target) return false;
    const { ctx } = this.m, target = owner.target.body.pos;
    for (let attempt = 0; attempt < 16; attempt++) {
      const angle = rand(0, Math.PI * 2), distance = rand(5.5, 12);
      const candidate = new Vector3(target.x + Math.sin(angle) * distance, target.y, target.z + Math.cos(angle) * distance);
      const node = ctx.nav.nodes[ctx.nav.nearest(candidate, 1, 1)];
      if (!node || Math.abs(node.y - target.y) > 1) continue;
      const pos = new Vector3(node.x, node.y, node.z), b = ctx.level.bounds;
      if (pos.x - 5 < b.minX || pos.x + 5 > b.maxX || pos.z - 5 < b.minZ || pos.z + 5 > b.maxZ) continue;
      if (this.rings.some(r => Math.hypot(r.pos.x - pos.x, r.pos.z - pos.z) < RING.spacing)) continue;
      const players = ctx.game.targets().filter(t => t.alive);
      if (players.some(t => Math.hypot(t.body.pos.x - pos.x, t.body.pos.z - pos.z) < RING.playerDistance)) continue;
      if (!players.every(t => hasRingEscape(ctx.nav, t, [...this.rings.map(r => r.pos), pos], ctx.world))) continue;
      const mesh = new Mesh(new RingGeometry(4.85, 5, 64), new MeshBasicMaterial({ color: 0xff4757, side: DoubleSide, transparent: true, opacity: 0.65, depthWrite: false }));
      mesh.name = 'moderator ban countdown'; mesh.rotation.x = -Math.PI / 2; mesh.position.copy(pos); mesh.position.y += 0.08;
      ctx.scene.add(mesh); this.rings.push({ pos, owner, age: 0, mesh });
      return true;
    }
    return false;
  }

  throwSmoke(from: Vector3, destination: Vector3): boolean {
    if (this.smoke.length >= 2) return false;
    const mesh = new Mesh(new SphereGeometry(1, 16, 12), new MeshBasicMaterial({ color: 0x809096, transparent: true, opacity: 0.85, depthWrite: false }));
    mesh.name = 'smoke grenade'; mesh.position.copy(from); mesh.scale.setScalar(0.15);
    this.m.ctx.scene.add(mesh);
    this.smoke.push({ from: from.clone(), destination: destination.clone(), pos: from.clone(), age: 0, mesh });
    return true;
  }

  obscures(a: Vector3, b: Vector3): boolean {
    const delta = b.clone().sub(a), length = delta.lengthSq();
    return this.smoke.some(s => {
      if (s.age < 1) return false;
      const t = length ? Math.max(0, Math.min(1, s.pos.clone().sub(a).dot(delta) / length)) : 0;
      return a.clone().addScaledVector(delta, t).distanceTo(s.pos) < 3.5;
    });
  }

  clearSmoke(center: Vector3, radius: number): void {
    for (let i = this.smoke.length - 1; i >= 0; i--) if (this.smoke[i]!.pos.distanceTo(center) < radius + 3.5) {
      this.disposeMesh(this.smoke[i]!.mesh); this.smoke.splice(i, 1);
    }
  }

  plantCharge(target: Breakable, pos: Vector3): boolean {
    if (!target.alive || this.charges.length || this.destroyedCover >= 3) return false;
    const { ctx } = this.m, group = new Group();
    const mesh = new Mesh(new BoxGeometry(0.5, 0.4, 0.3), new MeshBasicMaterial({ color: 0xffb020 }));
    group.name = 'sapper charge'; group.add(mesh); group.position.copy(pos); ctx.scene.add(group);
    const box = ctx.world.addBox(pos.clone().add(new Vector3(-0.25, -0.2, -0.15)), pos.clone().add(new Vector3(0.25, 0.2, 0.15)), { noNav: true, noGrapple: true });
    const slot = ctx.level.breakables.findIndex(p => !p.alive && p.group.name === 'sapper charge');
    const prop: Breakable = { id: slot < 0 ? ctx.level.breakables.length : slot, kind: 'crate', group, hp: 20, pos: pos.clone(), alive: true, tone: 3, box };
    box.data.breakable = prop;
    if (slot < 0) ctx.level.breakables.push(prop); else ctx.level.breakables[slot] = prop;
    ctx.world.finalize();
    this.charges.push({ prop, target, age: 0 });
    return true;
  }

  update(dt: number): void {
    const { ctx } = this.m;
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const ring = this.rings[i]!, previous = ring.age; ring.age += dt;
      if (!ring.owner.alive) {
        this.disposeMesh(ring.mesh); this.rings.splice(i, 1); continue;
      }
      ring.mesh.material.opacity = ring.age < 3 ? 0.45 + 0.35 * Math.sin(ring.age * 8) ** 2 : 0.9;
      ring.mesh.scale.setScalar(ring.age < 3 ? 0.85 + 0.15 * ring.age / 3 : 1);
      if (ring.age < 3) continue;
      ring.mesh.name = 'moderator active ban';
      for (const target of ctx.game.targets()) if (target.alive && inRing(target.body.pos, ring.pos)) {
        const dose = this.damage.get(target) ?? { amount: 0, from: ring.pos };
        dose.amount += 30 * Math.max(0, Math.min(ring.age, RING.countdown + RING.life) - Math.max(previous, RING.countdown)) * this.m.mods.damage;
        this.damage.set(target, dose);
      }
      if (ring.age >= RING.countdown + RING.life) { this.disposeMesh(ring.mesh); this.rings.splice(i, 1); }
    }
    // Keep the exact exposure damage, but do not trigger hurt audio/rumble every frame.
    this.damageT += dt;
    if (this.damageT >= 0.25) {
      this.damageT %= 0.25;
      for (const [target, dose] of this.damage) if (target.alive) target.takeDamage(dose.amount, dose.from);
      this.damage.clear();
    }
    for (let i = this.smoke.length - 1; i >= 0; i--) {
      const smoke = this.smoke[i]!; smoke.age += dt;
      if (smoke.age > 9) { this.disposeMesh(smoke.mesh); this.smoke.splice(i, 1); continue; }
      if (smoke.age < 1) {
        const next = smoke.from.clone().lerp(smoke.destination, smoke.age); next.y += 4 * Math.sin(Math.PI * smoke.age);
        const direction = next.clone().sub(smoke.pos), distance = direction.length();
        const hit = distance > 0 ? ctx.world.raycast(smoke.pos, direction.normalize(), distance) : null;
        if (hit) { smoke.pos.copy(hit.point).addScaledVector(hit.normal, 0.3); smoke.age = 1; }
        else smoke.pos.copy(next);
      } else if (smoke.mesh.name === 'smoke grenade') {
        // Finish the arc even if a frame steps past its final position.
        smoke.pos.copy(smoke.destination);
      }
      if (smoke.age >= 1) {
        smoke.mesh.name = 'smoke cloud'; smoke.mesh.scale.set(3.5, 2.6, 3.5);
        smoke.mesh.material.opacity = 0.78 * Math.min(1, (9 - smoke.age) / 1.5);
      }
      smoke.mesh.position.copy(smoke.pos);
    }
    for (let i = this.charges.length - 1; i >= 0; i--) {
      const charge = this.charges[i]!; charge.age += dt;
      if (!charge.prop.alive || !charge.target.alive) {
        this.removeCharge(charge); this.charges.splice(i, 1); continue;
      }
      charge.prop.group.scale.setScalar(1 + 0.12 * Math.sin(charge.age * 18));
      if (charge.age >= 3) {
        ctx.effects.explosion(charge.prop.pos, 2, 3); ctx.audio.explosion(charge.prop.pos);
        ctx.game.breakHit(charge.target, charge.target.hp, charge.target.pos, new Vector3(0, 1, 0));
        this.destroyedCover++; this.removeCharge(charge); this.charges.splice(i, 1);
      }
    }
  }

  private removeCharge(charge: Charge): void {
    charge.prop.alive = false; this.m.ctx.world.removeBox(charge.prop.box);
    charge.prop.group.traverse(o => { if (o instanceof Mesh) { o.geometry.dispose(); if (o.material instanceof MeshBasicMaterial) o.material.dispose(); } });
    charge.prop.group.removeFromParent();
  }
  private disposeMesh(mesh: Mesh<SphereGeometry | RingGeometry, MeshBasicMaterial>): void {
    mesh.removeFromParent(); mesh.geometry.dispose(); mesh.material.dispose();
  }
  clear(): void {
    this.rings.forEach(r => this.disposeMesh(r.mesh)); this.smoke.forEach(s => this.disposeMesh(s.mesh));
    this.charges.forEach(c => this.removeCharge(c));
    this.rings.length = this.smoke.length = this.charges.length = 0; this.destroyedCover = 0;
    this.damage.clear(); this.damageT = 0;
  }
}
