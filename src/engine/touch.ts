import type { Action } from './input';

export type TouchControl = 'look' | 'move' | 'fire' | 'fire-left' | 'aim' | 'grapple' | 'jump' | 'slide' | 'reload' | 'weapon';
type Contact = { control: TouchControl; x: number; y: number; cx: number; cy: number; radius: number; since: number; attached: boolean; grappleValid: boolean };
const actionFor = (control: TouchControl): Action | null => control === 'fire-left' ? 'fire'
  : control === 'slide' ? 'crouch' : control === 'weapon' ? 'nextWeapon'
  : ['fire', 'jump', 'reload'].includes(control) ? control as Action : null;

/** Pointer ownership and gesture timing. Sampled by Input, never a second game loop. */
export class TouchInput {
  enabled = false;
  readonly contacts = new Map<number, Contact>();
  readonly frame = new Set<Action>();
  readonly edges = new Set<Action>();
  readonly move = { x: 0, y: 0 };
  readonly look = { x: 0, y: 0 };
  aiming = false;
  hookPressed = false;
  detachPressed = false;
  reeling = false;
  getGrappleMode: () => 'idle' | 'fly' | 'on' = () => 'idle';
  onChange: (() => void) | null = null;
  #pending = new Set<Action>();
  #hook = false;
  #detach = false;

  start(id: number, control: TouchControl, x: number, y: number, rect: { left: number; top: number; width: number; height: number }, now = performance.now()): boolean {
    if (![x, y, rect.left, rect.top, rect.width, rect.height, now].every(Number.isFinite) || rect.width <= 0 || rect.height <= 0) return false;
    if (!this.enabled || this.contacts.has(id) || [...this.contacts.values()].some(c => c.control === control)) return false;
    const mode = this.getGrappleMode();
    const action = actionFor(control);
    // Both fire targets are one held action, independent of finger order.
    if (action && ![...this.contacts.values()].some(c => actionFor(c.control) === action)) this.#pending.add(action);
    this.contacts.set(id, { control, x, y, cx: rect.left + rect.width / 2, cy: rect.top + rect.height / 2,
      radius: rect.width * .32, since: now, attached: mode === 'on', grappleValid: true });
    if (control === 'grapple' && mode === 'idle') this.#hook = true;
    this.drag(id, x, y);
    this.onChange?.();
    return true;
  }

  drag(id: number, x: number, y: number): void {
    const c = this.contacts.get(id);
    if (!c || !Number.isFinite(x) || !Number.isFinite(y)) return;
    if (c.control === 'move') {
      const dx = (x - c.cx) / c.radius, dy = (c.cy - y) / c.radius;
      const length = Math.max(1, Math.hypot(dx, dy));
      this.move.x = dx / length; this.move.y = dy / length;
    } else if (c.control === 'look' || c.control === 'fire' || c.control === 'grapple') {
      this.look.x += x - c.x; this.look.y += y - c.y;
    }
    c.x = x; c.y = y;
  }

  end(id: number, cancelled = false, now = performance.now()): void {
    const c = this.contacts.get(id);
    if (!c) return;
    if (cancelled) { this.reset(); return; }
    this.contacts.delete(id);
    if (c.control === 'move') this.move.x = this.move.y = 0;
    if (c.control === 'aim') this.aiming = !this.aiming;
    if (c.control === 'grapple' && c.grappleValid && c.attached && now - c.since < 300 && this.getGrappleMode() === 'on') this.#detach = true;
    this.onChange?.();
  }

  sample(now = performance.now()): void {
    this.frame.clear(); this.edges.clear();
    for (const action of this.#pending) { this.frame.add(action); this.edges.add(action); }
    this.#pending.clear();
    for (const c of this.contacts.values()) {
      const action = actionFor(c.control);
      if (action) this.frame.add(action);
    }
    if (this.aiming) this.frame.add('aim');
    if (this.move.y > .85) this.frame.add('sprint');
    this.hookPressed = this.#hook; this.detachPressed = this.#detach;
    this.#hook = this.#detach = false;
    this.reeling = [...this.contacts.values()].some(c => c.control === 'grapple' && c.grappleValid
      && now - c.since >= 300 && this.getGrappleMode() === 'on');
  }

  /** Called by every real detach, including Launch, cuts, missed yanks and stamina loss. */
  cancelGrapple(): void {
    for (const c of this.contacts.values()) if (c.control === 'grapple') c.grappleValid = false;
    this.#hook = this.#detach = this.hookPressed = this.detachPressed = this.reeling = false;
  }

  reset(): void {
    this.contacts.clear(); this.frame.clear(); this.edges.clear(); this.#pending.clear();
    this.move.x = this.move.y = this.look.x = this.look.y = 0;
    this.aiming = false;
    this.cancelGrapple();
    this.onChange?.();
  }
}
