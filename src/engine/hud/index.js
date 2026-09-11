import { createElements, setText, setHTML, setBoldText } from './elements.js';
import { key, controlsHTML } from './labels.js';
export { Screens } from './screens.js';

const number = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const fraction = value => Math.min(1, Math.max(0, number(value)));
const count = value => Math.max(0, Math.floor(number(value)));
const visible = (el, on) => {
  el.classList.toggle('is-visible', !!on);
  el.setAttribute('aria-hidden', String(!on));
};

export class Hud {
  #root;
  #els;
  #gamepad = false;
  #messageT = 0;
  #tipT = 0;
  #messageAnimation;
  #hitAnimation;
  #slotKey = '';
  #tallyCount = -1;
  #grenadeCount = -1;
  #focusFraction = -1;
  onScreenClick = null;
  onUiAction = null;

  constructor(root) {
    this.#root = root;
    root.classList.add('game-hud');
    this.#els = createElements(root);
    const screen = this.#els.screen;
    const act = (el, ev) => {
      if (!el || el.disabled) return;
      let value = el.dataset.val ?? (el.matches('input,select,textarea') ? el.value : null);
      if (el.type === 'checkbox') value = el.checked ? '1' : '0';
      if (el.type === 'radio' && !el.checked) return;
      this.onUiAction?.(el.dataset.act, value, ev);
    };
    screen.addEventListener('click', ev => {
      const el = ev.target.closest('[data-act]');
      if (el || ev.target.closest('[data-ui-block],input,select,textarea,button,label')) {
        ev.stopPropagation();
        if (el && !el.matches('input,select,textarea')) act(el, ev);
        return;
      }
      this.onScreenClick?.();
    });
    for (const type of ['input', 'change']) screen.addEventListener(type, ev => {
      const el = ev.target.closest('[data-act]');
      if (!el) return;
      ev.stopPropagation();
      if (el.dataset.act === 'joinCode') el.value = el.value.toUpperCase().slice(0, 5);
      if (el.dataset.act === 'sens') {
        const output = screen.querySelector('[data-sens-output]');
        if (output) setText(output, `${el.value}%`);
      }
      act(el, ev);
    });
    for (const type of ['keydown', 'keyup']) screen.addEventListener(type, ev => {
      if (ev.target.closest('[data-ui-input-block],input,select,textarea,button')) ev.stopPropagation();
      if (type === 'keydown' && ev.key === 'Enter' && ev.target.matches('[data-act="joinCode"]')) {
        ev.preventDefault();
        act(ev.target, ev);
      }
      if (type === 'keydown' && ev.key === 'Tab') {
        const focusable = [...screen.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]')].filter(el => !el.hidden);
        const first = focusable[0], last = focusable.at(-1), active = root.ownerDocument.activeElement;
        if (!first) { ev.preventDefault(); this.#els.panel.focus({ preventScroll: true }); }
        else if (ev.shiftKey && (active === first || active === this.#els.panel)) { ev.preventDefault(); last.focus(); }
        else if (!ev.shiftKey && active === last) { ev.preventDefault(); first.focus(); }
      }
    });
  }

  dispose() {
    // Every listener sits on a child of #root, so dropping the subtree drops them.
    this.#messageAnimation?.cancel();
    this.#hitAnimation?.cancel();
    this.onScreenClick = this.onUiAction = null;
    this.#root.replaceChildren();
    this.#root.classList.remove('game-hud');
  }

  update(dt) {
    dt = Math.max(0, number(dt));
    if (this.#messageT > 0 && (this.#messageT -= dt) <= 0) {
      this.#messageAnimation?.cancel();
      visible(this.#els.message, false);
      setText(this.#els.messageSub, '');
    }
    if (this.#tipT > 0 && (this.#tipT -= dt) <= 0) visible(this.#els.tip, false);
  }

  setGameplayVisible(on) { this.#root.classList.toggle('no-gameplay', !on); }
  setDevice(pad) {
    this.#gamepad = !!pad;
    this.#root.classList.toggle('gamepad', this.#gamepad);
    for (const el of this.#root.querySelectorAll('[data-device]')) el.classList.toggle('current-device', el.dataset.device === (pad ? 'gamepad' : 'keyboard'));
  }
  key(action) { return key(action, this.#gamepad); }
  controlsHTML() { return controlsHTML(this.#gamepad); }

  setAmmo(mag, reserve, magSize, reloading) {
    mag = count(mag);
    setText(this.#els.magazine, mag);
    setText(this.#els.reserve, `/${count(reserve)}`);
    setText(this.#els.reloading, reloading ? ' reloading…' : '');
    this.#els.magazine.setAttribute('aria-label', `${mag} of ${count(magSize)} rounds`);
    const tally = Math.min(40, mag);
    if (this.#tallyCount !== tally) {
      this.#tallyCount = tally;
      this.#els.tally.innerHTML = '<i></i>'.repeat(tally);
    }
  }

  setKatanaAmmo() {
    setText(this.#els.magazine, '∞');
    this.#els.magazine.setAttribute('aria-label', 'Unlimited');
    setText(this.#els.reserve, '');
    setText(this.#els.reloading, '');
    this.#els.tally.replaceChildren();
    this.#tallyCount = 0;
  }

  setSlots(slots) {
    const rows = Array.isArray(slots) ? slots : [];
    const signature = JSON.stringify(rows.map(({ name, active, ammo, empty }) => [name, !!active, ammo, !!empty]));
    if (signature === this.#slotKey) return;
    this.#slotKey = signature;
    const doc = this.#root.ownerDocument;
    const children = rows.map((slot, index) => {
      const row = doc.createElement('div');
      row.className = `weapon-slot${slot.active ? ' active' : ''}${slot.empty ? ' empty' : ''}`;
      const badge = doc.createElement('span');
      badge.className = 'slot-badge';
      badge.textContent = index + 1;
      const name = doc.createElement('span');
      name.textContent = slot.name;
      const ammo = doc.createElement('span');
      ammo.className = 'slot-ammo';
      ammo.textContent = slot.ammo;
      row.append(badge, name, ammo);
      return row;
    });
    this.#els.slots.replaceChildren(...children);
  }

  setGrenades(n) {
    n = Math.min(5, count(n));
    if (n === this.#grenadeCount) return;
    this.#grenadeCount = n;
    this.#els.grenades.innerHTML = '<i class="grenade-icon" aria-hidden="true"></i>'.repeat(n);
    this.#els.grenades.setAttribute('aria-label', `${n} grenades`);
  }

  setBreath(frac) {
    frac = fraction(frac);
    this.#els.breath.hidden = frac >= 0.995;
    this.#els.breath.classList.toggle('low', frac < 0.2);
    const percent = Math.round(frac * 100);
    this.#els.breathFill.style.width = `${percent}%`;
    this.#els.breath.setAttribute('aria-valuenow', percent);
  }

  setHealth(hp, max) {
    hp = number(hp);
    const frac = max > 0 ? Math.max(0, hp / max) : 0;
    this.#root.classList.toggle('low-health', frac < 0.3);
    this.#els.healthFill.style.width = `${(frac * 100).toFixed(1)}%`;
    this.#els.health.setAttribute('aria-valuenow', Math.round(fraction(frac) * 100));
    this.#els.health.setAttribute('aria-valuetext', `${Math.ceil(hp)} of ${number(max)} HP`);
    setText(this.#els.hp, Math.ceil(hp));
  }

  setSpread(px) { this.#els.crosshair.style.setProperty('--spread', `${Math.max(0, number(px)).toFixed(1)}px`); }
  setCrosshairMode(mode) { this.#els.crosshair.classList.toggle('katana', mode === 'katana'); }
  setAds(on) { this.#els.crosshair.classList.toggle('ads', !!on); }
  setScope(on) { visible(this.#els.scope, on); }
  setGrappleTarget(state) { this.#els.grappleReticle.dataset.state = state === 1 || state === 2 ? state : 0; }

  setFocusMeter(show, frac, ready, label) {
    visible(this.#els.focusMeter, show);
    if (!show) return;
    frac = fraction(frac);
    if (Math.abs(frac - this.#focusFraction) > 0.005) {
      this.#focusFraction = frac;
      this.#els.focusFill.style.height = `${frac * 100}%`;
    }
    this.#els.focusMeter.classList.toggle('ready', !!ready);
    setText(this.#els.focusLabel, label);
  }

  setFocusMark(x, y) {
    const show = x !== null && Number.isFinite(x) && Number.isFinite(y);
    visible(this.#els.focusMark, show);
    if (show) {
      this.#els.focusMark.style.left = `${Math.round(x)}px`;
      this.#els.focusMark.style.top = `${Math.round(y)}px`;
    }
  }

  setBoss(name, frac) {
    visible(this.#els.boss, name != null);
    if (name != null) {
      setText(this.#els.bossName, name);
      this.#els.bossFill.style.width = `${fraction(frac) * 100}%`;
    }
  }

  hitmarker(kill, crit) {
    const marker = this.#els.hitmarker;
    marker.classList.toggle('kill', !!kill);
    marker.classList.toggle('crit', !!crit);
    this.#hitAnimation?.cancel();
    this.#hitAnimation = marker.animate([
      { opacity: 1, transform: 'translate(-50%, -50%) scale(1.5)' },
      { opacity: 0, transform: 'translate(-50%, -50%) scale(1)' },
    ], { duration: 200, easing: 'ease-out' });
  }

  damageFrom(angle) {
    if (!Number.isFinite(angle)) return;
    const indicator = this.#root.ownerDocument.createElement('div');
    indicator.className = 'damage-direction';
    indicator.style.transform = `rotate(${angle}rad)`;
    this.#els.damageIndicators.append(indicator);
    indicator.animate([{ opacity: 0.9 }, { opacity: 0 }], { duration: 1000, easing: 'linear' }).onfinish = () => indicator.remove();
  }

  setScore(score, combo) {
    setText(this.#els.score, number(score));
    setText(this.#els.combo, combo > 1 ? `combo x${count(combo)}` : '');
  }
  setWave(wave, left) { setText(this.#els.wave, count(wave)); setText(this.#els.enemies, count(left)); }
  setModifier(text) { setText(this.#els.modifier, text); }
  setTimer(text) { setText(this.#els.timer, text); }
  setWeapon(name, hint) { setText(this.#els.weaponName, name); setText(this.#els.weaponHint, hint); }

  message(main, sub = '', dur = 2.2) {
    setText(this.#els.messageMain, main);
    setText(this.#els.messageSub, sub);
    this.#messageT = Math.max(0, number(dur));
    this.#messageAnimation?.cancel();
    visible(this.#els.message, this.#messageT > 0);
    if (this.#messageT > 0) this.#messageAnimation = this.#els.messageMain.animate([
      { opacity: 0, transform: 'scale(1.7)', filter: 'blur(3px)', offset: 0 },
      { opacity: 1, transform: 'scale(0.95)', filter: 'blur(0)', offset: 0.55 },
      { opacity: 1, transform: 'scale(1)', filter: 'blur(0)', offset: 1 },
    ], { duration: 550, easing: 'ease-out' });
  }

  tip(html, dur = 5) {
    setBoldText(this.#els.tip, html);
    this.#tipT = Math.max(0, number(dur));
    visible(this.#els.tip, this.#tipT > 0);
  }

  kill(text, pts = 0) {
    const line = this.#root.ownerDocument.createElement('div');
    line.className = 'kill-line';
    line.textContent = String(text ?? '');
    if (number(pts) > 0) {
      const points = this.#root.ownerDocument.createElement('strong');
      points.textContent = ` +${number(pts)}`;
      line.append(points);
    }
    this.#els.killFeed.append(line);
    if (this.#els.killFeed.children.length > 6) this.#els.killFeed.firstElementChild.remove();
    line.animate([
      { opacity: 0, transform: 'translateX(30px)', offset: 0 },
      { opacity: 1, transform: 'translateX(0)', offset: 0.15 },
      { opacity: 1, transform: 'translateX(0)', offset: 0.75 },
      { opacity: 0, transform: 'translateX(0)', offset: 1 },
    ], { duration: 1700 }).onfinish = () => line.remove();
  }

  setPvpScore(html) {
    this.#els.pvpScore.hidden = html == null;
    this.#els.topRight.classList.toggle('pvp', html != null);
    setHTML(this.#els.pvpScore, html);
    if (html != null) this.setModifier('');
  }
  setBoard(html) { this.#els.board.hidden = html == null; setHTML(this.#els.board, html); }
  boardHidden() { return this.#els.board.hidden || !this.#els.screen.hidden; }

  showScreen(html) {
    this.#els.panel.innerHTML = String(html ?? '');
    this.#els.panel.scrollTop = 0;
    this.#els.screen.hidden = false;
    this.#root.classList.add('screen-open');
    const title = this.#els.panel.querySelector('h1');
    if (title) {
      title.id = `${this.#root.id || 'hud'}-screen-title`;
      this.#els.panel.setAttribute('aria-labelledby', title.id);
    } else this.#els.panel.removeAttribute('aria-labelledby');
    this.setDevice(this.#gamepad);
    this.#els.panel.focus({ preventScroll: true });
  }
  hideScreen() { this.#els.screen.hidden = true; this.#root.classList.remove('screen-open'); }
}
