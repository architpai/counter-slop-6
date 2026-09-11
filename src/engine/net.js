import Peer from 'peerjs';

export const NET = Object.freeze({
  PREFIX_LIVE: 'shooter-rebuild-v1-', PREFIX_DEV: 'shooter-rebuild-dev-v1-',
  PUBLIC_SLOTS: 8, CODE_LEN: 5, CODE_ALPHABET: 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789',
  CODE_RETRIES: 3, MAX_PLAYERS: 8, SIGNAL_TIMEOUT: 12000, JOIN_TIMEOUT: 14000,
  QUICK_TIMEOUT: 11000, REFUSE_CLOSE_DELAY: 400, SILENT_TIMEOUT: 9000,
});

const HOST = new Set(['lobby', 'leave', 'start', 'end', 'backtolobby', 'score', 'pickup', 'taken', 'refused']);
const REQUEST = new Set(['startreq', 'take']);
const ADDRESSED = new Set(['pdmg', 'parry', 'cut']);
const BROADCAST = new Set(['ps', 'shots', 'pdead', 'nade', 'brk']);
const TYPES = new Set(['welcome', ...HOST, ...REQUEST, ...ADDRESSED, ...BROADCAST]);
const encoder = new TextEncoder();
const own = (o, k) => Object.hasOwn(o, k);
const object = o => o !== null && typeof o === 'object' && !Array.isArray(o) &&
  (Object.getPrototypeOf(o) === Object.prototype || Object.getPrototypeOf(o) === null);
const text = (s, max, min = 0) => typeof s === 'string' && s.length >= min && s.length <= max;
const peerId = s => text(s, 128, 1);
const integer = n => Number.isSafeInteger(n) && n >= 0;
const bounded = (n, limit = 10000) => Number.isFinite(n) && Math.abs(n) <= limit;
const vector = (v, limit = 10000) => Array.isArray(v) && v.length === 3 && v.every(n => bounded(n, limit));
const optional = (o, k, check) => !own(o, k) || check(o[k]);
const fields = (o, required, extra = []) => object(o) && required.every(k => own(o, k)) &&
  Object.keys(o).every(k => required.includes(k) || extra.includes(k));
const empty = o => fields(o, []);
const idRecord = (o, positive = false) => fields(o, ['id']) && integer(o.id) && (!positive || o.id > 0);
const rows = (arr, score = false) => Array.isArray(arr) && arr.length <= NET.MAX_PLAYERS &&
  new Set(arr.map(row => row?.id)).size === arr.length && arr.every(row =>
    fields(row, score ? ['id', 'name', 'kills', 'deaths'] : ['id', 'name']) &&
    peerId(row.id) && text(row.name, 14) && (!score || integer(row.kills) && integer(row.deaths)));

function validPayload(type, d) {
  switch (type) {
    case 'welcome': return fields(d, ['hostId', 'code', 'isPublic']) && peerId(d.hostId) &&
      text(d.code, 64, 1) && typeof d.isPublic === 'boolean';
    case 'refused': return fields(d, [], ['reason']) && optional(d, 'reason', s => text(s, 256));
    case 'lobby': return fields(d, ['players', 'hostId', 'isPublic'], ['map']) &&
      rows(d.players) && peerId(d.hostId) && typeof d.isPublic === 'boolean' && optional(d, 'map', s => text(s, 64));
    case 'leave': return fields(d, ['id']) && peerId(d.id);
    case 'startreq': case 'backtolobby': case 'cut': return empty(d);
    case 'start': return fields(d, [], ['spawns', 'spawn', 'map', 'late', 'broken']) &&
      optional(d, 'map', s => text(s, 64)) && optional(d, 'late', b => typeof b === 'boolean') &&
      optional(d, 'spawn', integer) && optional(d, 'spawns', s => object(s) &&
        Object.keys(s).length <= NET.MAX_PLAYERS && Object.entries(s).every(([id, index]) => peerId(id) && integer(index))) &&
      optional(d, 'broken', a => Array.isArray(a) && a.length <= 4096 && a.every(integer));
    case 'end': return fields(d, ['id', 'name']) && peerId(d.id) && text(d.name, 14);
    case 'score': return rows(d, true);
    case 'ps': return Array.isArray(d) && [8, 11, 14].includes(d.length) &&
      d.slice(0, 3).every(n => bounded(n)) && Number.isFinite(d[3]) && bounded(d[4], 1.6) &&
      Number.isSafeInteger(d[5]) && integer(d[6]) && d[6] <= 511 && integer(d[7]) && d[7] <= 120 &&
      d.slice(8).every(n => bounded(n));
    case 'shots': return fields(d, ['k', 'e']) && text(d.k, 32) && Array.isArray(d.e) &&
      d.e.length > 0 && d.e.length <= 90 && d.e.length % 3 === 0 && d.e.every(n => bounded(n));
    case 'pdmg': return fields(d, ['amount', 'from', 'by', 'src'], ['crit']) &&
      Number.isFinite(d.amount) && d.amount > 0 && d.amount <= 100000 &&
      (d.from === null || vector(d.from)) && peerId(d.by) && text(d.src, 32) &&
      optional(d, 'crit', b => typeof b === 'boolean');
    case 'pdead': return fields(d, ['killer', 'dir', 'over', 'how', 'crit']) &&
      (d.killer === null || peerId(d.killer)) && (d.dir === null || vector(d.dir, 1)) &&
      typeof d.over === 'boolean' && typeof d.crit === 'boolean' && (d.how === null || text(d.how, 64));
    case 'parry': return fields(d, ['ret', 'by']) && typeof d.ret === 'boolean' && peerId(d.by);
    case 'nade': return fields(d, ['pos', 'vel']) && vector(d.pos) && vector(d.vel);
    case 'brk': return idRecord(d);
    case 'pickup': return fields(d, ['id', 'kind', 'pos']) && integer(d.id) && d.id > 0 &&
      ['ammo', 'health'].includes(d.kind) && vector(d.pos);
    case 'take': case 'taken': return idRecord(d, true);
    default: return false;
  }
}

function validEnvelope(m) {
  try {
    return fields(m, ['t', 'd'], ['from', 'to', 'relay']) && TYPES.has(m.t) &&
      optional(m, 'from', peerId) && optional(m, 'to', peerId) &&
      optional(m, 'relay', b => typeof b === 'boolean') && validPayload(m.t, m.d) &&
      encoder.encode(JSON.stringify(m)).byteLength <= 16384;
  } catch { return false; }
}

function listen(emitter, type, fn) {
  emitter.on(type, fn);
  return () => {
    if (typeof emitter.off === 'function') emitter.off(type, fn);
    else emitter.removeListener?.(type, fn);
  };
}

function stop(conn) { try { conn.close(); } catch { /* Already closed. */ } }
function destroy(peer) { try { peer.destroy(); } catch { /* Already destroyed. */ } }
function errorOf(error, fallback) {
  return error instanceof Error ? error : new Error(text(error?.message, 256, 1) ? error.message : fallback);
}
function metadata(meta) {
  return { name: typeof meta?.name === 'string' ? meta.name.trim().slice(0, 14) || 'recruit' : 'recruit' };
}
function prefix() {
  return ['localhost', '127.0.0.1', '[::1]'].includes(globalThis.location?.hostname) ? NET.PREFIX_DEV : NET.PREFIX_LIVE;
}
function randomCode() {
  return Array.from({ length: NET.CODE_LEN }, () => NET.CODE_ALPHABET[Math.floor(Math.random() * NET.CODE_ALPHABET.length)]).join('');
}

export class Net {
  #peer = null;
  #id = null;
  #code = null;
  #connected = false;
  #epoch = 0;
  #leaving = false;
  #conns = new Map();
  #allConns = new Set();
  #bindings = new Map();
  #peerBindings = [];
  #cancels = new Set();
  #timers = new Set();
  #handlers = new Map();
  #sent = 0;
  #received = 0;

  constructor() {
    this.hostId = null;
    this.isHost = false;
    this.isPublic = true;
    this.accepting = false;
    this.onPeerJoin = null;
    this.onPeerLeave = null;
    this.onDisconnect = null;
  }

  get id() { return this.#id; }
  get code() { return this.#code; }
  get active() { return !!this.#peer && this.#connected; }
  get conns() { return this.#conns; }

  async host(o = {}) {
    this.leave();
    const epoch = this.#epoch;
    this.isHost = true;
    this.isPublic = o?.isPublic !== false;
    const explicit = typeof o?.code === 'string' ? o.code.toUpperCase() : null;
    const count = explicit !== null ? 1 : this.isPublic ? NET.PUBLIC_SLOTS : NET.CODE_RETRIES;
    for (let i = 0; i < count; i++) {
      const code = explicit ?? (this.isPublic ? `PUB${i}` : randomCode());
      try {
        if (!text(code, 64, 1)) throw new Error('enter a lobby code');
        await this.#openPeer(prefix() + code, epoch);
        if (epoch !== this.#epoch) throw new Error('connection request cancelled');
        this.#code = code;
        this.hostId = this.#id;
        this.#connected = true;
        this.accepting = true;
        return;
      } catch (error) {
        if (epoch !== this.#epoch) throw error;
        if (error.type !== 'unavailable-id' || explicit !== null || i === count - 1) {
          if (this.isPublic && explicit === null && error.type === 'unavailable-id') {
            throw new Error('all public lobbies are busy - host a private one');
          }
          throw error;
        }
      }
    }
  }

  async join(code, meta) {
    this.leave();
    const epoch = this.#epoch;
    code = typeof code === 'string' ? code.trim().toUpperCase() : '';
    if (!code) throw new Error('enter a lobby code');
    await this.#openPeer(null, epoch);
    if (epoch !== this.#epoch) throw new Error('connection request cancelled');
    await this.#knock([code], meta, NET.JOIN_TIMEOUT, epoch, false);
  }

  async quickJoin(meta, onStatus) {
    this.leave();
    const epoch = this.#epoch;
    onStatus?.('looking for an open lobby…');
    await this.#openPeer(null, epoch);
    if (epoch !== this.#epoch) throw new Error('connection request cancelled');
    try {
      await this.#knock(Array.from({ length: NET.PUBLIC_SLOTS }, (_, i) => `PUB${i}`), meta,
        NET.QUICK_TIMEOUT, epoch, true);
    } catch (error) {
      if (epoch === this.#epoch) this.leave();
      throw error;
    }
  }

  leave() {
    this.#leaving = true;
    this.#epoch++;
    for (const cancel of [...this.#cancels]) cancel();
    this.#cancels.clear();
    for (const timer of this.#timers) clearTimeout(timer);
    this.#timers.clear();
    for (const conn of this.#allConns) this.#unwire(conn);
    this.#conns.clear();
    for (const conn of this.#allConns) stop(conn);
    this.#allConns.clear();
    for (const off of this.#peerBindings) off();
    this.#peerBindings = [];
    const peer = this.#peer;
    this.#peer = null;
    if (peer) destroy(peer);
    this.#id = this.#code = this.hostId = null;
    this.#connected = this.isHost = this.accepting = false;
    this.#leaving = false;
  }

  close(id) {
    const conn = this.#conns.get(id);
    if (!conn) return;
    this.#conns.delete(id);
    this.#forget(conn);
    if (!this.isHost && id === this.hostId) this.#connected = false;
  }

  on(type, fn) {
    if (TYPES.has(type) && typeof fn === 'function') this.#handlers.set(type, fn);
  }

  send(type, data, relay = false) {
    if (!this.active || type === 'welcome' || ADDRESSED.has(type)) return;
    if (this.isHost) {
      if (!HOST.has(type) && !BROADCAST.has(type)) return;
      const m = type === 'refused' ? { t: type, d: data } : { t: type, d: data, from: this.#id };
      if (validEnvelope(m)) for (const conn of this.#conns.values()) this.#write(conn, m);
    } else {
      if (!REQUEST.has(type) && !(BROADCAST.has(type) && relay === true)) return;
      if (REQUEST.has(type) && relay) return;
      const m = { t: type, d: data, relay };
      if (validEnvelope(m)) this.#write(this.#conns.get(this.hostId), m);
    }
  }

  broadcast(type, data) { this.send(type, data, true); }

  sendTo(id, type, data) {
    if (!this.active || !peerId(id) || id === this.#id || type === 'welcome') return;
    if (this.isHost) {
      if (!HOST.has(type) && !BROADCAST.has(type) && !ADDRESSED.has(type)) return;
      if ((type === 'pdmg' || type === 'parry') && data?.by !== this.#id) return;
      const m = type === 'refused' ? { t: type, d: data } : { t: type, d: data, from: this.#id };
      if (validEnvelope(m)) this.#write(this.#conns.get(id), m);
    } else {
      if (!ADDRESSED.has(type) || ((type === 'pdmg' || type === 'parry') && data?.by !== this.#id)) return;
      const m = { t: type, d: data, to: id, from: this.#id };
      if (validEnvelope(m)) this.#write(this.#conns.get(this.hostId), m);
    }
  }

  #delay(fn, ms) {
    const timer = setTimeout(() => { this.#timers.delete(timer); fn(); }, ms);
    this.#timers.add(timer);
    return timer;
  }

  #clearTimer(timer) { clearTimeout(timer); this.#timers.delete(timer); }

  #openPeer(id, epoch) {
    return new Promise((resolve, reject) => {
      if (typeof Peer !== 'function') { reject(new Error('networking library did not load')); return; }
      let peer;
      try {
        const options = { debug: 0, config: { iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
          { urls: 'stun:stun.cloudflare.com:3478' },
        ] } };
        peer = id === null ? new Peer(options) : new Peer(id, options);
      } catch (error) { reject(errorOf(error, 'could not connect')); return; }
      this.#peer = peer;
      let settled = false;
      const off = [];
      const cancel = () => finish(new Error('connection request cancelled'));
      const finish = (error, openedId) => {
        if (settled) return;
        settled = true;
        this.#clearTimer(timer);
        off.forEach(remove => remove());
        this.#cancels.delete(cancel);
        if (error || epoch !== this.#epoch) {
          if (this.#peer === peer) this.#peer = null;
          destroy(peer);
          reject(error || new Error('connection request cancelled'));
          return;
        }
        this.#id = openedId;
        this.#peerBindings = [
          listen(peer, 'disconnected', () => {
            if (this.#peer === peer && epoch === this.#epoch && !peer.destroyed) {
              try { peer.reconnect(); } catch { /* Retry on the next disconnect. */ }
            }
          }),
          listen(peer, 'connection', conn => {
            if (this.#peer === peer && epoch === this.#epoch && this.isHost) this.#accept(conn, epoch);
            else stop(conn);
          }),
          listen(peer, 'error', () => {}), // Knock listeners handle peer-unavailable; channels own established-session errors.
          listen(peer, 'close', () => {
            if (this.#peer !== peer || epoch !== this.#epoch) return;
            for (const conn of [...this.#conns.values()]) this.#drop(conn);
            this.#connected = false;
          }),
        ];
        resolve(peer);
      };
      const timer = this.#delay(() => finish(new Error('signalling server timed out')), NET.SIGNAL_TIMEOUT);
      this.#cancels.add(cancel);
      off.push(listen(peer, 'open', openedId => {
        if (peerId(openedId) && (id === null || openedId === id)) finish(null, openedId);
        else finish(new Error('could not connect'));
      }), listen(peer, 'error', error => finish(errorOf(error, 'could not connect'))));
    });
  }

  #knock(codes, meta, timeout, epoch, quick) {
    const peer = this.#peer;
    return new Promise((resolve, reject) => {
      const attempts = new Map();
      let settled = false;
      let remaining = codes.length;
      const cancel = () => finish(null, new Error('connection request cancelled'));
      const offError = listen(peer, 'error', error => {
        if (error?.type !== 'peer-unavailable') return;
        const id = typeof error.message === 'string' ? /\bpeer\s+(\S+)/i.exec(error.message)?.[1] : null;
        const attempt = attempts.get(id);
        if (attempt) fail(attempt, new Error('no lobby with that code'));
      });
      const timer = this.#delay(() => finish(null, new Error(quick ? 'no open public lobbies' : 'no answer from that lobby')), timeout);
      const finish = (winner, error) => {
        if (settled) return;
        settled = true;
        this.#clearTimer(timer);
        offError();
        this.#cancels.delete(cancel);
        for (const attempt of attempts.values()) {
          this.#unwire(attempt.conn);
          if (attempt !== winner) this.#forget(attempt.conn);
        }
        if (!winner || epoch !== this.#epoch) {
          if (winner) this.#forget(winner.conn);
          reject(error || new Error('connection request cancelled'));
          return;
        }
        // Adopt before resolving: welcome/lobby/start can arrive in the same event-loop turn.
        this.hostId = winner.id;
        this.#code = winner.code;
        this.isPublic = winner.welcome.isPublic;
        this.#connected = true;
        this.#conns.set(winner.id, winner.conn);
        this.#wire(winner.conn);
        this.#handlers.get('welcome')?.(winner.welcome, winner.id);
        resolve();
      };
      const fail = (attempt, error) => {
        if (settled || attempt.failed) return;
        attempt.failed = true;
        this.#forget(attempt.conn);
        remaining--;
        if (!quick || remaining === 0) finish(null, quick ? new Error('no open public lobbies') : error);
      };
      this.#cancels.add(cancel);
      for (const code of codes) {
        if (settled) break;
        const id = prefix() + code;
        let conn;
        try { conn = peer.connect(id, { reliable: true, serialization: 'json', metadata: metadata(meta) }); }
        catch { conn = null; }
        if (!conn) {
          remaining--;
          if (!quick || remaining === 0) finish(null, new Error(quick ? 'no open public lobbies' : 'could not start a connection'));
          continue;
        }
        const attempt = { conn, id, code, failed: false, welcome: null };
        attempts.set(id, attempt);
        this.#allConns.add(conn);
        this.#bindings.set(conn, [
          listen(conn, 'data', m => {
            if (settled || attempt.failed || epoch !== this.#epoch || !validEnvelope(m) ||
                own(m, 'to') || own(m, 'relay')) return;
            if (m.t === 'refused' && !own(m, 'from')) {
              fail(attempt, new Error(m.d.reason || 'the lobby turned you away'));
            } else if (m.t === 'welcome' && m.from === id && m.d.hostId === id && m.d.code === code && conn.peer === id) {
              attempt.welcome = m.d;
              this.#received++;
              finish(attempt);
            }
          }),
          listen(conn, 'close', () => fail(attempt, new Error('the lobby closed the connection'))),
          listen(conn, 'error', error => fail(attempt, errorOf(error, 'could not connect'))),
        ]);
      }
    });
  }

  #accept(conn, epoch) {
    this.#allConns.add(conn);
    const open = () => {
      if (epoch !== this.#epoch || !this.active || !this.isHost) { this.#forget(conn); return; }
      this.#unwire(conn);
      const reason = !this.accepting || !peerId(conn.peer) || conn.peer === this.#id || this.#conns.has(conn.peer) ?
        'that lobby is closed' : this.#conns.size >= NET.MAX_PLAYERS - 1 ? 'that lobby is full' : null;
      if (reason) {
        this.#write(conn, { t: 'refused', d: { reason } });
        this.#delay(() => this.#forget(conn), NET.REFUSE_CLOSE_DELAY);
        return;
      }
      this.#conns.set(conn.peer, conn);
      this.#wire(conn);
      this.#write(conn, { t: 'welcome', d: { hostId: this.#id, code: this.#code, isPublic: this.isPublic }, from: this.#id });
      if (this.#conns.get(conn.peer) === conn) this.onPeerJoin?.(conn.peer, metadata(conn.metadata));
    };
    this.#bindings.set(conn, [listen(conn, 'open', open),
      listen(conn, 'error', () => this.#forget(conn)), listen(conn, 'close', () => this.#forget(conn))]);
    if (conn.open) open();
  }

  #wire(conn) {
    this.#unwire(conn);
    this.#bindings.set(conn, [listen(conn, 'data', m => this.#receive(conn, m)),
      listen(conn, 'close', () => this.#drop(conn)), listen(conn, 'error', () => this.#drop(conn))]);
  }

  #unwire(conn) {
    this.#bindings.get(conn)?.forEach(off => off());
    this.#bindings.delete(conn);
  }

  #forget(conn) { this.#unwire(conn); this.#allConns.delete(conn); stop(conn); }

  #drop(conn) {
    const id = conn.peer;
    if (this.#leaving || this.#conns.get(id) !== conn) return;
    this.#conns.delete(id);
    this.#forget(conn);
    if (this.isHost) {
      this.onPeerLeave?.(id);
      this.send('leave', { id });
    } else if (id === this.hostId) {
      this.#connected = false;
      this.onDisconnect?.();
    }
  }

  #write(conn, m) {
    if (!conn?.open) return;
    try { conn.send(m); this.#sent++; }
    catch { this.#drop(conn); }
  }

  #receive(conn, m) {
    if (!this.active || this.#conns.get(conn.peer) !== conn || !validEnvelope(m) || m.t === 'welcome') return;
    let sender;
    if (this.isHost) {
      sender = conn.peer;
      if (HOST.has(m.t)) return;
      if ((m.t === 'pdmg' || m.t === 'parry') && m.d.by !== sender) return;
      if (REQUEST.has(m.t)) {
        if (own(m, 'to') || m.relay === true) return;
      } else if (ADDRESSED.has(m.t)) {
        if (!own(m, 'to') || own(m, 'relay') || m.to === sender) return;
        if (m.to !== this.#id) {
          const target = this.#conns.get(m.to);
          if (target?.open) this.#write(target, { t: m.t, d: m.d, from: sender });
          return;
        }
      } else if (BROADCAST.has(m.t)) {
        if (m.relay !== true || own(m, 'to')) return;
        for (const [id, target] of this.#conns) {
          if (id !== sender) this.#write(target, { t: m.t, d: m.d, from: sender });
        }
      } else return;
    } else {
      if (conn.peer !== this.hostId || own(m, 'to') || own(m, 'relay') || REQUEST.has(m.t)) return;
      if (m.t === 'refused') {
        if (own(m, 'from')) return;
        sender = this.hostId;
      } else {
        sender = m.from;
        if (!peerId(sender) || sender === this.#id || (HOST.has(m.t) && sender !== this.hostId)) return;
        if (m.t === 'lobby' && m.d.hostId !== this.hostId) return;
        if ((m.t === 'pdmg' || m.t === 'parry') && m.d.by !== sender) return;
      }
    }
    this.#received++;
    const data = m.t === 'pdmg' && !own(m.d, 'crit') ? { ...m.d, crit: false } : m.d;
    this.#handlers.get(m.t)?.(data, sender);
  }
}
