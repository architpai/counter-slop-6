import { Vector3 } from 'three';
import type { App } from '../boot';
import type { EnemyRecord } from '../enemies';
import { syncModel } from '../enemies/model';
import { TRAINING_TYPES } from '../level/training';
import { seeThrough } from '../physics';

export function createTraining(app: App) {
  const { ctx } = app;
  const slots: { enemy: EnemyRecord; deadFor: number }[] = [];
  const direction = new Vector3();

  function spawn(index: number): EnemyRecord {
    const type = TRAINING_TYPES[index], position = ctx.level.spawns[index];
    if (!type || !position || !ctx.enemies) throw new Error('training: missing target slot');
    const enemy = ctx.enemies.spawn(type, position);
    enemy.state = 'hunt';
    enemy.root.scale.setScalar(enemy.stats.scale);
    enemy.yaw = enemy.yawTo = enemy.root.rotation.y = 0;
    enemy.body.onGround = !enemy.stats.flying;
    syncModel(enemy);
    return enemy;
  }

  /** Called after resetRun, which owns actor, grenade and effect cleanup. */
  function reset(): void {
    slots.length = 0;
    TRAINING_TYPES.forEach((_, i) => slots.push({ enemy: spawn(i), deadFor: 0 }));
    ctx.hud.setWave(0, slots.length);
    ctx.hud.setModifier('TRAINING · PASSIVE TARGETS');
    ctx.hud.message('TRAINING GROUND', 'Walk around the models · targets return after 3 seconds', 4);
    ctx.hud.tip('Unlimited reserve ammo and grenades · reload normally · pause to reset the range', 9);
  }

  function update(dt: number): void {
    const player = ctx.player, enemies = ctx.enemies;
    if (!player || !enemies) return;
    for (const [i, slot] of slots.entries()) {
      if (slot.enemy.alive) continue;
      slot.deadFor += dt;
      if (slot.deadFor >= 3) { slot.enemy = spawn(i); slot.deadFor = 0; }
    }
    player.addAmmoAll(1);
    player.grenades = player.maxGrenades;
    ctx.hud.setWave(0, enemies.alive);
    ctx.camera.getWorldDirection(direction);
    const hit = enemies.raycast(ctx.camera.position, direction, 150);
    const clear = hit && !ctx.world.raycast(ctx.camera.position, direction, hit.dist, seeThrough);
    ctx.hud.setBoss(clear ? `${hit.enemy.stats.name} · ${Math.ceil(hit.enemy.hp)} / ${hit.enemy.maxHp} HP` : null,
      clear ? hit.enemy.hp / hit.enemy.maxHp : 0);
    ctx.hud.setTimer(clear ? `${Math.round(hit.dist)} m · ${hit.part === 'head' ? 'HEAD' : hit.part === 'shield' ? 'SHIELD' : 'BODY'}` : 'Pause → reset range');
  }

  return { reset, update };
}

export type TrainingApi = ReturnType<typeof createTraining>;
