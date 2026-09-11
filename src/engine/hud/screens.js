import { controlsHTML } from './labels.js';

const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[char]);
const count = value => Number.isFinite(value) ? Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, Math.floor(value))) : 0;
const list = value => Array.isArray(value) ? value.filter(item => item && typeof item === 'object') : [];
const title = (heading, subtitle = '') => `<h1 class="screen-title">${escape(heading)}</h1>${subtitle ? `<h2 class="screen-subtitle">${escape(subtitle)}</h2>` : ''}`;
const status = text => `<p class="screen-status" role="status" aria-live="polite">${escape(text)}</p>`;
const button = (action, text, { value, primary = false, sub = '', disabled = false } = {}) =>
  `<button type="button" class="screen-button${primary ? ' primary' : ''}" data-act="${escape(action)}"${value == null ? '' : ` data-val="${escape(value)}"`}${disabled ? ' disabled' : ''}>${escape(text)}${sub ? `<small>${escape(sub)}</small>` : ''}</button>`;
const mainMenu = () => `<div class="screen-actions" data-ui-block>${button('mainMenu', 'MAIN MENU')}</div>`;
const prompt = (confirmKey, end, start = 'CLICK ANYWHERE') => `<p class="screen-prompt">${start} (or press <span data-control="confirm">${escape(confirmKey)}</span>) ${end}</p>`;

function settings(m) {
  const sens = Number.isFinite(m.sens) ? Math.min(250, Math.max(25, Math.round(m.sens / 5) * 5)) : 100;
  return `<div class="settings" data-ui-block data-ui-input-block>
    <label class="settings-row">look sensitivity <input type="range" data-act="sens" min="25" max="250" step="5" value="${sens}"><output data-sens-output>${sens}%</output></label>
    <label class="settings-row"><input type="checkbox" data-act="invert"${m.invert ? ' checked' : ''}> invert vertical look</label>
    <label class="settings-row"><input type="checkbox" data-act="music"${m.music ? ' checked' : ''}> music <span class="dim">(M)</span></label>
  </div>`;
}

function checkpoints(wave) {
  // ponytail: render at most 1,000 checkpoint buttons; paginate if runs pass wave 5,000.
  const n = Math.min(1000, Math.floor(count(wave) / 5));
  return n ? `<div class="checkpoints" data-ui-block><h3>checkpoints</h3>${Array.from({ length: n }, (_, i) =>
    button('checkpoint', `WAVE ${(i + 1) * 5}`, { value: (i + 1) * 5 })).join('')}</div>` : '';
}

function maps(m, disabled = false) {
  const choices = list(m.maps);
  return choices.length < 2 ? '' : `<div class="map-picker" data-ui-block><h3>map</h3>${choices.map(map => {
    const selected = map.key === m.mapKey;
    return `<button type="button" class="screen-button map-choice${selected ? ' selected' : ''}" data-act="pickMap" data-val="${escape(map.key)}" aria-pressed="${selected}"${disabled ? ' disabled' : ''}><span>${escape(map.name)}</span><small>${escape(map.blurb)}</small></button>`;
  }).join('')}</div>`;
}

const sorted = rows => list(rows).slice().sort((a, b) => count(b.kills) - count(a.kills) || count(a.deaths) - count(b.deaths));

function scoreRows(rows, full = false) {
  return `<div class="score-rows">${sorted(rows).map(row => `<div${row.self ? ' class="self"' : ''}>
    <span>${escape(row.name)}${full && row.self ? ' (you)' : ''}</span><span>${count(row.kills)} ${full ? 'kills' : 'K'} · ${count(row.deaths)} ${full ? 'deaths' : 'D'}</span>
  </div>`).join('')}</div>`;
}

export const Screens = {
  main(m) {
    return `${title('COUNTER SLOP 6', 'a tactical survival shooter, allegedly')}
      <div class="screen-actions" data-ui-block>
        ${button('start', 'START', { primary: true, sub: 'solo · survive the waves' })}
        ${button('online', 'PLAY ONLINE', { sub: 'free for all · up to 8 players' })}
      </div>${maps(m)}${controlsHTML(m.confirmKey === '✕')}${settings(m)}${checkpoints(m.checkpoint)}
      ${count(m.best) > 0 ? `<p class="screen-footer">best score: ${count(m.best)}</p>` : ''}`;
  },

  online(m) {
    const isPublic = m.isPublic !== false;
    return `${title('PLAY ONLINE', 'free for all · first to 20 · up to 8 players')}
      <div class="online-box" data-ui-block data-ui-input-block>
        <label class="settings-row">your name <input type="text" data-act="name" maxlength="14" value="${escape(String(m.name ?? '').slice(0, 14))}" autocomplete="nickname" spellcheck="false"></label>
        <div class="screen-actions">${button('quickPlay', 'QUICK PLAY', { primary: true, disabled: m.busy })}</div>
        <p class="screen-footer">jumps into an open public lobby, or opens one for you</p>
        <p class="online-or">or</p>
        <div class="screen-actions">${button('create', 'CREATE LOBBY', { disabled: m.busy })}</div>
        <div class="visibility-options" role="group" aria-label="Lobby visibility">
          <label><input type="radio" name="lobby-visibility" data-act="visibility" data-val="public" value="public"${isPublic ? ' checked' : ''}> public</label>
          <label><input type="radio" name="lobby-visibility" data-act="visibility" data-val="private" value="private"${isPublic ? '' : ' checked'}> private · friends only</label>
        </div>
        <div class="settings-row"><label>have a code? <input type="text" data-act="joinCode" maxlength="5" placeholder="CODE" value="${escape(String(m.code ?? '').toUpperCase().slice(0, 5))}" autocomplete="off" autocapitalize="characters" spellcheck="false" aria-label="Lobby code"></label>${button('join', 'JOIN', { disabled: m.busy })}</div>
        ${status(m.status)}<div class="screen-actions">${button('back', 'BACK')}</div>
      </div>`;
  },

  lobby(m) {
    const players = list(m.players);
    return `${title('LOBBY', `free for all · first to 20 · ${players.length}/8 players`)}
      <p>code <strong class="lobby-code">${escape(m.code)}</strong></p>${maps(m, !m.isHost)}
      <p class="screen-footer">${m.isPublic ? 'this lobby is public: anyone can quick play in, or type the code' : 'private lobby: friends type this code under PLAY ONLINE → JOIN'}</p>
      <div class="lobby-players">${players.map(player => `<div${player.self ? ' class="self"' : ''}><span>${escape(player.name)}${player.host ? '<span class="dim"> · host</span>' : ''}</span><span>${player.self ? 'you' : ''}</span></div>`).join('')}</div>
      <div class="screen-actions" data-ui-block>${button('startMatch', 'START MATCH', { primary: true })}${button('leave', 'LEAVE')}</div>
      ${status(m.status)}<p class="screen-footer">anyone can start · ${players.length < 2 ? 'people can still join once it is running' : `${players.length} players in`}</p>`;
  },

  pause(m) {
    return `${title('PAUSED', `wave ${count(m.wave)} · score ${count(m.score)}`)}${controlsHTML(m.confirmKey === '✕')}${settings(m)}${mainMenu()}${prompt(m.confirmKey, 'TO RESUME')}`;
  },

  menu(m) {
    return `${title('MENU', `free for all · lobby ${m.code ?? ''}`)}${scoreRows(m.rows)}${controlsHTML(m.confirmKey === '✕')}${settings(m)}
      <div class="screen-actions" data-ui-block>${button('leaveMatch', 'LEAVE MATCH')}</div>${prompt(m.confirmKey, 'TO KEEP PLAYING')}`;
  },

  matchOn(m) {
    return `${title('MATCH ON', 'free for all · first to 20')}${prompt(m.confirmKey, 'TO PLAY')}`;
  },

  dead(m) {
    const waves = count(m.waves);
    return `${title('ELIMINATED')}<p class="screen-stats">you survived <b>${waves}</b> ${waves === 1 ? 'wave' : 'waves'} · <b>${count(m.kills)}</b> kills · score <b>${count(m.score)}</b> · ${m.newBest ? '<b>NEW BEST</b>' : `best ${count(m.best)}`}</p>
      ${checkpoints(m.checkpoint)}${mainMenu()}${prompt(m.confirmKey, 'TO DRAW AGAIN', 'CLICK')}`;
  },

  over(m) {
    return `${title(m.youWin ? 'YOU WIN' : `${m.winnerName || 'someone'} WINS`)}${scoreRows(m.rows)}<p class="screen-prompt">back to the lobby in a moment…</p>`;
  },

  scoreboard(m) {
    return `<h2 class="screen-subtitle">FREE FOR ALL</h2>${scoreRows(m.rows, true)}<p class="screen-footer">first to 20 · lobby ${escape(m.code)}</p>`;
  },

  pvpScore(m) {
    return `<div class="score-rows">${sorted(m.rows).map((row, rank) => ({ row, rank, self: row.id === m.selfId }))
      .filter(({ rank, self }) => rank < 3 || self).map(({ row, rank, self }) => `<div${self ? ' class="self"' : ''}><span class="dim">${rank + 1}.</span><span>${escape(row.name)}${self ? ' (you)' : ''}</span><b>${count(row.kills)}</b></div>`).join('')}</div><p class="screen-footer">first to 20</p>`;
  },
};
