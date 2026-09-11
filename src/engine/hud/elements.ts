/**
 * Every `data-hud` name the template below produces, with the element type its
 * tag gives. The template is the only producer of these nodes, so this table is
 * complete and correct by construction; `Hud` indexes it directly.
 */
export type HudElements = {
  scope: HTMLDivElement;
  focusMeter: HTMLDivElement;
  focusLabel: HTMLDivElement;
  focusFill: HTMLDivElement;
  focusMark: HTMLDivElement;
  crosshair: HTMLDivElement;
  grappleReticle: HTMLDivElement;
  breath: HTMLDivElement;
  breathFill: HTMLDivElement;
  hitmarker: HTMLDivElement;
  damageIndicators: HTMLDivElement;
  /** `<strong>` */
  score: HTMLElement;
  combo: HTMLDivElement;
  topRight: HTMLDivElement;
  /** `<strong>` */
  wave: HTMLElement;
  modifier: HTMLDivElement;
  /** `<strong>` */
  enemies: HTMLElement;
  timer: HTMLDivElement;
  pvpScore: HTMLDivElement;
  board: HTMLDivElement;
  boss: HTMLDivElement;
  bossName: HTMLDivElement;
  bossFill: HTMLDivElement;
  health: HTMLDivElement;
  healthFill: HTMLDivElement;
  /** `<strong>` */
  hp: HTMLElement;
  /** `<strong>` */
  magazine: HTMLElement;
  reserve: HTMLSpanElement;
  reloading: HTMLSpanElement;
  grenades: HTMLSpanElement;
  tally: HTMLDivElement;
  slots: HTMLDivElement;
  weaponName: HTMLDivElement;
  weaponHint: HTMLDivElement;
  tip: HTMLDivElement;
  message: HTMLDivElement;
  messageMain: HTMLDivElement;
  messageSub: HTMLDivElement;
  killFeed: HTMLDivElement;
  screen: HTMLDivElement;
  /** `<section>` */
  panel: HTMLElement;
};

export function createElements(root: HTMLElement): HudElements {
  root.innerHTML = `
    <div class="scope" data-hud="scope" aria-hidden="true">
      <div class="scope-ring"></div><div class="scope-cross horizontal"></div>
      <div class="scope-cross vertical"></div><div class="scope-dot"></div>
    </div>
    <div class="focus-meter" data-hud="focusMeter" aria-hidden="true">
      <div class="focus-label" data-hud="focusLabel">KATANA</div>
      <div class="focus-tube"><div class="focus-fill" data-hud="focusFill"></div>
        <div class="focus-flames"><i></i><i></i><i></i></div>
      </div><div class="focus-ready">SLASH READY</div>
    </div>
    <div class="focus-mark" data-hud="focusMark" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
    <div class="crosshair" data-hud="crosshair" aria-hidden="true">
      <i class="tick top"></i><i class="tick bottom"></i><i class="tick left"></i><i class="tick right"></i><i class="dot"></i>
    </div>
    <div class="grapple-reticle" data-hud="grappleReticle" data-state="0" aria-hidden="true"></div>
    <div class="grapple-breath" data-hud="breath" hidden aria-label="Grapple breath" role="meter" aria-valuemin="0" aria-valuemax="100">
      <div data-hud="breathFill"></div>
    </div>
    <div class="hit-marker" data-hud="hitmarker" aria-hidden="true"><i></i><i></i></div>
    <div class="damage-indicators" data-hud="damageIndicators" aria-hidden="true"></div>
    <div class="top-left hud-block"><div>SCORE <strong data-hud="score">0</strong></div><div class="combo" data-hud="combo"></div></div>
    <div class="top-right hud-block" data-hud="topRight">
      <div class="wave-line">WAVE <strong data-hud="wave">1</strong></div>
      <div class="modifier" data-hud="modifier"></div>
      <div class="enemies-line"><strong data-hud="enemies">0</strong> enemies left</div>
      <div class="timer" data-hud="timer"></div><div class="pvp-score" data-hud="pvpScore" hidden></div>
    </div>
    <div class="scoreboard" data-hud="board" hidden></div>
    <div class="boss-bar" data-hud="boss" aria-hidden="true">
      <div class="boss-name" data-hud="bossName"></div><div class="boss-track"><div data-hud="bossFill"></div></div>
    </div>
    <div class="bottom-left hud-block">
      <div class="health-row"><span>HP</span><div class="health-track" data-hud="health" role="meter" aria-label="Health" aria-valuemin="0" aria-valuemax="100" aria-valuenow="100"><div data-hud="healthFill"></div></div><strong data-hud="hp">100</strong></div>
      <div class="ammo-row"><strong class="magazine" data-hud="magazine">30</strong><span class="reserve" data-hud="reserve">/120</span><span class="reloading" data-hud="reloading"></span><span class="grenades" data-hud="grenades"></span></div>
      <div class="ammo-tally" data-hud="tally" aria-hidden="true"></div>
    </div>
    <div class="bottom-right hud-block"><div class="weapon-slots" data-hud="slots"></div><div class="weapon-name" data-hud="weaponName">RIFLE</div><div class="weapon-hint" data-hud="weaponHint"></div></div>
    <div class="tip-line" data-hud="tip" role="status"></div>
    <div class="center-message" data-hud="message" role="status"><div class="message-main" data-hud="messageMain"></div><div class="message-sub" data-hud="messageSub"></div></div>
    <div class="kill-feed" data-hud="killFeed" role="log" aria-live="polite"></div>
    <div class="screen-overlay" data-hud="screen" hidden><section class="screen-panel" data-hud="panel" role="dialog" aria-modal="true" aria-label="Game menu" tabindex="-1"></section></div>
  `;
  // Keys and tags come from the literal above, so the table matches `HudElements`.
  return Object.fromEntries([...root.querySelectorAll<HTMLElement>('[data-hud]')]
    .map((el): [string, HTMLElement] => [el.dataset.hud ?? '', el])) as HudElements;
}

export function setText(el: HTMLElement, value: unknown): void {
  const text = String(value ?? '');
  if (el.textContent !== text) el.textContent = text;
}

export function setHTML(el: HTMLElement, value: unknown): void {
  const html = String(value ?? '');
  if (el.dataset.lastHtml !== html) {
    el.innerHTML = html;
    el.dataset.lastHtml = html;
  }
}

export function setBoldText(el: HTMLElement, value: unknown): void {
  const doc = el.ownerDocument;
  const template = doc.createElement('template');
  template.innerHTML = String(value ?? '');
  const copy = (source: Node, target: ParentNode): void => {
    for (const node of source.childNodes) {
      if (node.nodeType === 3) target.append(doc.createTextNode(node.textContent ?? ''));
      else if (node.nodeType === 1) {
        if (node.nodeName === 'SCRIPT' || node.nodeName === 'STYLE') continue;
        if (node.nodeName === 'B' || node.nodeName === 'STRONG') {
          const bold = doc.createElement('b');
          copy(node, bold);
          target.append(bold);
        } else copy(node, target);
      }
    }
  };
  const fragment = doc.createDocumentFragment();
  copy(template.content, fragment);
  el.replaceChildren(fragment);
}
