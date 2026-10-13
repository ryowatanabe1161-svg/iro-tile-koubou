/* いろタイル工房 〜ふーさんの宮殿の壁〜 オンライン版
 * 構成：WebRTC（PeerJS）による P2P。ホストのブラウザが唯一の正（authoritative）で、合法手チェック・ふーさん🐻の手・得点計算もホストが行います。
 * 盤面はすべて公開情報なので、全員に同じ状態を送ります（袋の中身は枚数だけ）。
 */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var L = window.AZ;
  var Q = new URLSearchParams(location.search);
  var CFG = window.IRO_CONFIG || {};
  var ICE = (CFG.iceServers && CFG.iceServers.length) ? CFG.iceServers : [{ urls: 'stun:stun.l.google.com:19302' }];
  if (Q.get('ice')) ICE = Q.get('ice').split(',').map(function (u) { return { urls: u }; });   // テスト・独自環境用
  var PEER_OPTS = Object.assign({ debug: 1, config: { iceServers: ICE } }, CFG.peer || {});
  var ID_PREFIX = 'iro-tile-v1-', CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  var TURBO = Q.has('turbo');
  var T = TURBO ? { cpu: [120, 260], pause: 700, endPause: 900, sumShow: 600 } : { cpu: [700, 1400], pause: 3400, endPause: 3600, sumShow: 3200 };
  var MAX_HUMANS = 4, HB_MS = 3000, LOST_MS = 10000;
  var CN = ['藍', '山吹', '紅', '墨', '白磁'];
  var LV = { weak: '弱い', normal: '普通', strong: '強い' };
  var LV_KEYS = ['weak', 'normal', 'strong'];
  var BEAR = '🐻', CPU_BASE = 'ふーさん' + BEAR;
  var CPU_LINES = {
    weak: ['このきれいな色にするクマ〜', 'えいっ、これにするクマ！', 'なんとなく これクマ♪'],
    normal: ['ここがそろうと気持ちいいクマ', 'この段に ぴったりクマね', 'こつこつ並べるクマ〜'],
    strong: ['その色、いただきクマ！', 'つながりで点を取るクマ', '縦の列をねらってるクマ…'],
    floor: ['あちゃ〜、床に落ちたクマ…', 'わざと床に置いたクマ（ほんとクマ）'],
    marker: ['先手マーカーもらうクマ！'],
    done: ['1段そろったクマ〜！']
  };
  var LS_ID = 'iro-client-id', LS_NAME = 'iro-name', LS_HOST = 'iro-host-room', SS_CLIENT = 'iro-joined';
  function store(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v)); } catch (e) {} }
  function load(k, json) { try { var v = localStorage.getItem(k); return json ? JSON.parse(v) : v; } catch (e) { return null; } }
  function sstore(k, v) { try { if (v == null) sessionStorage.removeItem(k); else sessionStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function sload(k) { try { return JSON.parse(sessionStorage.getItem(k)); } catch (e) { return null; } }
  function rid(n) { var s = ''; for (var i = 0; i < n; i++) s += 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random() * 36)]; return s; }
  var myId = load(LS_ID) || (function () { var v = rid(16); store(LS_ID, v); return v; })();
  function esc(t) { return String(t == null ? '' : t).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function pick(a) { return a[Math.floor(Math.random() * a.length)]; }
  function rand(a) { return a[0] + Math.random() * (a[1] - a[0]); }
  function cleanName(n) { return String(n || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 8); }
  var PARTY = window.FuuParty && window.FuuParty.info;   // ひろばの「みんなの部屋」から来たとき
  function genCode() { if (PARTY && PARTY.host) return PARTY.code; var c = ''; for (var i = 0; i < 4; i++) c += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]; return c; }
  function normCode(c) { return String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/O/g, '0').replace(/I/g, '1').slice(0, 4); }
  function inviteUrl(code) { var u = location.origin + location.pathname + '?room=' + code; if (Q.get('ice')) u += '&ice=' + encodeURIComponent(Q.get('ice')); return u; }

  // ---------- 汎用UI ----------
  function show(id) { ['title', 'lobby', 'game', 'end'].forEach(function (s) { $(s).classList.toggle('active', s === id); }); }
  function overlay(id, on) { $(id).classList.toggle('active', on); }
  var toastT;
  function toast(msg) { var t = $('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(function () { t.classList.remove('show'); }, 3000); }
  function banner(msg) { var b = $('banner'); b.textContent = msg || ''; b.classList.toggle('show', !!msg); }
  function confirmBox(title, text, yes, cb) {
    $('cfTitle').textContent = title; $('cfText').textContent = text; $('cfYes').textContent = yes; $('cfNo').style.display = '';
    overlay('confirmModal', true);
    $('cfYes').onclick = function () { overlay('confirmModal', false); cb(); };
    $('cfNo').onclick = function () { overlay('confirmModal', false); };
  }
  function alertBox(msg) { confirmBox('お知らせ', msg, 'OK', function () {}); $('cfNo').style.display = 'none'; }
  function connecting(on, title, text, onCancel) {
    overlay('connecting', on);
    if (on) { $('connTitle').textContent = title || '接続中…'; $('connText').textContent = text || ''; $('connCancel').onclick = onCancel || function () { location.href = location.pathname; }; }
  }
  $('rulesBtn1').onclick = $('rulesBtn2').onclick = function () { overlay('rulesModal', true); };
  $('rulesClose').onclick = function () { overlay('rulesModal', false); };
  ['rulesModal', 'menuModal'].forEach(function (id) { $(id).addEventListener('click', function (e) { if (e.target === this) overlay(id, false); }); });
  // =====================================================================
  //  ホスト（authoritative）
  // =====================================================================
  var host = null;
  function hostId(code) { return ID_PREFIX + code; }
  function newRoom(name) {
    return { code: genCode(), phase: 'lobby', opts: { seats: 2, lv: ['normal', 'normal', 'normal', 'normal'] }, nextSid: 2, gameNo: 0,
      seats: [{ sid: 1, name: name, kind: 'host', clientId: myId, connected: true }], G: null, notice: null, lobbyReq: null };
  }
  function startHost(name, resumeRoom) {
    document.body.classList.add('is-host');
    host = { room: resumeRoom || newRoom(name), conns: {}, lastSeen: {}, tries: 0, opened: false };
    if (resumeRoom) host.room.seats.forEach(function (s) { if (s.kind === 'remote') s.connected = false; });
    connecting(true, resumeRoom ? '部屋を再開しています…' : '部屋を作っています…', 'シグナリングサーバーに接続中', function () { location.href = location.pathname; });
    openHostPeer();
    setInterval(hostHeartbeat, 2000);
    setInterval(hostTick, TURBO ? 40 : 100);
  }
  // 席：人間が参加順に先、残りは ふーさん🐻1, 2…（人数は 2〜4、人間が多ければ人間の数）
  function seatTotal(seats, opts) { return Math.max(2, Math.min(4, Math.max(opts.seats, seats.length))); }
  function planPlayers(seats, opts) {
    var n = seatTotal(seats, opts), out = [], ci = 0;
    for (var i = 0; i < n; i++) {
      var h = seats[i];
      out.push(h ? { kind: 'human', sid: h.sid, name: h.name } : { kind: 'cpu', lv: opts.lv[ci++] || 'normal', name: '' });
    }
    var cpus = out.filter(function (o) { return o.kind === 'cpu'; });
    cpus.forEach(function (o, i) { o.name = cpus.length > 1 ? CPU_BASE + (i + 1) : CPU_BASE; });
    return out;
  }
  function hostStartGame() {
    var R = host.room;
    if (!R.seats.length) return;
    R.gameNo++; R.lobbyReq = null;
    var pl = planPlayers(R.seats, R.opts);
    R.G = { st: L.newGame(pl.length, Math.random), pl: pl, last: null, log: [], logId: 0, cpuAt: 0, pauseUntil: Date.now() + (TURBO ? 300 : 900), summary: null, final: null, endAt: 0, say: null };
    log(-1, 'ラウンド1 スタート！ 先手は ' + pl[R.G.st.turn].name);
    R.phase = 'game';
    hostBroadcast();
  }
  function log(p, text) { var G = host.room.G; G.log.push({ id: ++G.logId, p: p, text: text }); if (G.log.length > 6) G.log.shift(); }
  function rowName(r) { return r < 0 ? '床' : (r + 1) + '段目'; }
  function applyMove(p, m) {
    var R = host.room, G = R.G, st = G.st, o = G.pl[p];
    var res = L.take(st, p, m, Math.random);
    if (res.err) return res.err;
    G.cpuAt = 0;
    G.last = { id: st.moves, p: p, src: m.src, c: m.c, row: m.row, n: res.n, toFloor: res.toFloor, marker: res.marker };
    log(p, o.name + '：' + (m.src === 'C' ? '中央' : '工房' + (m.src + 1)) + 'から' + CN[m.c] + '×' + res.n + ' → ' + rowName(m.row) + (m.row >= 0 && res.toFloor ? '（床' + res.toFloor + '）' : '') + (res.marker ? ' ＋先手🐻' : ''));
    if (o.kind === 'cpu') {
      var line = null;
      if (res.marker && Math.random() < 0.6) line = pick(CPU_LINES.marker);
      else if (res.toFloor >= 3) line = pick(CPU_LINES.floor);
      else if (m.row >= 0 && st.players[p].lines[m.row].n === m.row + 1 && Math.random() < 0.35) line = pick(CPU_LINES.done);
      else if (Math.random() < 0.18) line = pick(CPU_LINES[o.lv] || CPU_LINES.normal);
      if (line) G.say = { id: st.moves, p: p, text: line };
    }
    if (res.roundEnd) {
      var s = res.summary;
      G.summary = { id: s.round, round: s.round, players: s.players, over: !!res.over };
      log(-1, 'ラウンド' + s.round + ' 終了：' + s.players.map(function (x, q) { return G.pl[q].name + ' ' + (x.gain ? '+' + x.gain : '±0') + (x.pen ? ' −' + x.pen : ''); }).join('、'));
      if (res.over) { G.final = res.final; G.endAt = Date.now() + T.endPause; }
      else { G.pauseUntil = Date.now() + T.pause; log(-1, 'ラウンド' + st.round + ' スタート！ 先手は ' + G.pl[st.turn].name); }
    }
    hostBroadcast();
    return null;
  }
  function hostAction(sid, m) {
    var R = host.room, G = R.G; if (!G || R.phase !== 'game') return null;
    var st = G.st, p = st.turn, o = G.pl[p];
    if (st.over) return null;
    if (!o || o.kind !== 'human' || o.sid !== sid) return 'あなたの番ではありません';
    if (m.t !== 'take') return null;
    var src = m.src === 'C' ? 'C' : (m.src | 0), c = m.c | 0, row = m.row | 0;
    if (src !== 'C' && (src < 0 || src >= st.factories.length)) return 'その工房はありません';
    if (c < 0 || c > 4 || row < -1 || row > 4) return '置けません';
    var err = applyMove(p, { src: src, c: c, row: row });
    return err ? ({ color: 'その色のタイルはありません', row: 'その段には置けません（色ちがい・満杯・壁にもう同じ色）', src: 'その場所はありません', turn: 'あなたの番ではありません' }[err] || '置けません') : null;
  }
  function hostTick() {
    if (!host || !host.opened) return;
    var R = host.room, G = R.G, now = Date.now();
    if (R.phase !== 'game' || !G) return;
    // 代打ちしていた ふーさん → 本人が戻ったら返す
    G.pl.forEach(function (o) { if (o.subFor) { var s = seatBySid(o.subFor); if (s && s.connected) { o.kind = 'human'; o.sid = o.subFor; o.name = s.name; delete o.subFor; delete o.lv; toastAll(s.name + 'が戻ってきました'); hostBroadcast(); } } });
    if (G.st.over) { if (now >= G.endAt) { R.phase = 'end'; hostBroadcast(); } return; }
    if (G.pauseUntil) { if (now < G.pauseUntil) return; G.pauseUntil = 0; hostBroadcast(); }
    var o = G.pl[G.st.turn];
    if (o.kind === 'cpu') {
      if (!G.cpuAt) G.cpuAt = now + rand(T.cpu);
      if (now >= G.cpuAt) { var m = L.aiMove(G.st, G.st.turn, o.lv, Math.random); if (m) applyMove(G.st.turn, m); }
    }
  }
  function hostSubstitute() {   // 切断中の人の席を ふーさんが代打ち
    var G = host.room.G, o = G.pl[G.st.turn]; if (!o || o.kind !== 'human') return;
    var s = seatBySid(o.sid); if (!s || s.connected) return;
    o.subFor = o.sid; o.kind = 'cpu'; o.lv = 'normal'; o.name = s.name + '（代打ち' + BEAR + '）'; G.cpuAt = 0;
    toastAll(BEAR + ' ふーさんが ' + s.name + ' の代わりに打ちます'); hostBroadcast();
  }
  function viewFor(sid) {
    var R = host.room, G = R.G, now = Date.now(), you = -1;
    R.seats.forEach(function (s, i) { if (s.sid === sid) you = i; });
    var v = { t: 'state', phase: R.phase, code: R.code, you: you, sid: sid, gameNo: R.gameNo, opts: { seats: R.opts.seats, lv: R.opts.lv.slice() },
      seats: R.seats.map(function (s) { return { sid: s.sid, name: s.name, kind: s.kind, connected: s.kind !== 'remote' || s.connected }; }), notice: R.notice };
    if (sid === 1 && R.lobbyReq && R.phase !== 'lobby') v.lobbyReq = R.lobbyReq;
    if (R.phase === 'lobby' || !G) return v;
    var st = G.st, cur = G.pl[st.turn], curSeat = cur && cur.kind === 'human' ? seatBySid(cur.sid) : null;
    v.g = { n: st.moves, round: st.round, turn: st.turn, over: st.over, factories: st.factories, center: st.center, marker: st.marker, bag: st.bag.length, lid: st.lid.length,
      players: st.players.map(function (P, p) { var o = G.pl[p], s = o.kind === 'human' ? seatBySid(o.sid) : null; return { name: o.name, kind: o.kind, sid: o.sid, lv: o.lv, sub: !!o.subFor, connected: !s || s.connected, lines: P.lines, wall: P.wall, floor: P.floor, score: P.score }; }),
      last: G.last, log: G.log, say: G.say, summary: G.summary, final: G.final, ranking: st.over ? L.ranking(st) : null,
      pause: Math.max(0, G.pauseUntil - now), curOff: !!(curSeat && !curSeat.connected) };
    return v;
  }

  function openHostPeer() {
    var R = host.room, peer = new Peer(hostId(R.code), PEER_OPTS);
    host.peer = peer;
    peer.on('open', function () { host.opened = true; host.tries = 0; connecting(false); banner(''); hostRender(); saveHost(); });
    peer.on('connection', function (conn) {
      conn.on('data', function (msg) { hostOnMessage(conn, msg); });
      conn.on('close', function () { hostConnClosed(conn); });
      conn.on('error', function () { hostConnClosed(conn); });
    });
    peer.on('disconnected', function () { if (!peer.destroyed) setTimeout(function () { try { peer.reconnect(); } catch (e) {} }, 2000); });
    peer.on('error', function (e) {
      if (e.type === 'unavailable-id') {
        try { peer.destroy(); } catch (x) {}
        if (!host.opened && R.phase === 'lobby' && !host.resuming && !PARTY) { R.code = genCode(); openHostPeer(); return; }
        if (++host.tries > 25) { connecting(false); toast('部屋を再開できませんでした'); return; }
        connecting(true, '部屋を再開しています…', '少し時間がかかることがあります（' + host.tries + '）');
        setTimeout(openHostPeer, 3000);
      } else if (['network', 'server-error', 'socket-error', 'socket-closed'].indexOf(e.type) >= 0) {
        if (!host.opened) { connecting(true, 'サーバーに接続できません', '通信環境を確認してください。再試行しています…'); setTimeout(function () { try { peer.destroy(); } catch (x) {} openHostPeer(); }, 4000); }
        else banner('シグナリングサーバーとの接続が不安定です（ゲームは続行できます）');
      } else if (e.type === 'browser-incompatible') connecting(true, 'このブラウザは対応していません', 'Chrome / Safari の最新版でお試しください');
    });
  }
  function seatByClient(cid) { return host.room.seats.filter(function (s) { return s.clientId === cid; })[0]; }
  function seatBySid(sid) { return host.room.seats.filter(function (s) { return s.sid === sid; })[0]; }
  function hostOnMessage(conn, msg) {
    if (!msg || typeof msg !== 'object') return;
    var R = host.room;
    if (msg.t === 'join') return hostJoin(conn, msg);
    var seat = conn.clientId && seatByClient(conn.clientId);
    if (!seat || host.conns[conn.clientId] !== conn) return;
    host.lastSeen[conn.clientId] = Date.now();
    if (msg.t === 'ping') return;
    if (msg.t === 'lobbyReq') return hostLobbyReq(seat);
    if (msg.t === 'leave') {
      if (R.phase === 'lobby') R.seats.splice(R.seats.indexOf(seat), 1); else { seat.connected = false; seat.left = true; seat.lostAt = Date.now(); }
      delete host.conns[conn.clientId]; try { conn.close(); } catch (e) {}
      if (R.phase !== 'lobby') toastAll(seat.name + 'が退出しました');
      hostBroadcast(); return;
    }
    if (R.phase !== 'game' || msg.g !== R.gameNo || msg.n !== R.G.st.moves) return;
    var err = hostAction(seat.sid, msg);
    if (err) { try { conn.send({ t: 'error', msg: err }); conn.send(viewFor(seat.sid)); } catch (e) {} }
  }
  function hostJoin(conn, msg) {
    var R = host.room, name = cleanName(msg.name), cid = String(msg.clientId || '').slice(0, 40);
    function reject(text) { conn.send({ t: 'reject', msg: text }); setTimeout(function () { try { conn.close(); } catch (e) {} }, 500); }
    if (!name || !cid) return reject('ニックネームを入力してください');
    if (cid === myId) return reject('ホストと同じ端末・ブラウザからは参加できません');
    var seat = seatByClient(cid);
    if (!seat) { seat = R.seats.filter(function (s) { return s.name === name && s.kind === 'remote' && !s.connected; })[0]; if (seat) seat.clientId = cid; }
    if (seat) {
      if (seat.kind !== 'remote') return reject('この名前は使えません');
      var old = host.conns[cid]; if (old && old !== conn) { try { old.close(); } catch (e) {} }
      seat.connected = true; seat.left = false;
    } else {
      if (R.phase !== 'lobby') return reject('この部屋はゲーム中です。前に参加していた人は、同じニックネームで入ると元の席に戻れます。');
      if (R.seats.length >= MAX_HUMANS) return reject('満員です（最大' + MAX_HUMANS + '人）');
      if (R.seats.some(function (s) { return s.name === name; }) || /^ふーさん/.test(name)) return reject('その名前は使えません。別のニックネームにしてください。');
      seat = { sid: R.nextSid++, name: name, kind: 'remote', clientId: cid, connected: true };
      R.seats.push(seat);
    }
    conn.clientId = cid; host.conns[cid] = conn; host.lastSeen[cid] = Date.now();
    conn.send({ t: 'welcome', code: R.code, sid: seat.sid });
    hostBroadcast();
  }
  function hostConnClosed(conn) {
    if (!conn.clientId || host.conns[conn.clientId] !== conn) return;
    delete host.conns[conn.clientId];
    var seat = seatByClient(conn.clientId);
    if (seat && seat.connected) { seat.connected = false; seat.lostAt = Date.now(); hostBroadcast(); }
  }
  function hostHeartbeat() {
    if (!host) return;
    var now = Date.now();
    Object.keys(host.conns).forEach(function (cid) {
      var c = host.conns[cid];
      try { c.send({ t: 'hb' }); } catch (e) {}
      if (now - (host.lastSeen[cid] || 0) > LOST_MS) { try { c.close(); } catch (e) {} hostConnClosed(c); }
    });
  }
  function toastAll(msg) { var R = host.room; R.notice = { id: (R.notice ? R.notice.id : 0) + 1, msg: msg, toast: true }; }
  function hostToLobby(msg) {
    var R = host.room;
    R.phase = 'lobby'; R.G = null; R.lobbyReq = null;
    R.seats = R.seats.filter(function (s) { if (s.kind === 'remote') { s.left = false; return !!s.connected; } return true; });
    R.notice = { id: (R.notice ? R.notice.id : 0) + 1, msg: msg };
    hostBroadcast();
  }
  function hostLobbyReq(seat) {
    var R = host.room;
    if (seat.kind !== 'remote' || R.phase === 'lobby') return;
    if (R.lobbyReq && R.lobbyReq.sid === seat.sid && Date.now() - R.lobbyReq.at < 5000) return;
    R.lobbyReq = { sid: seat.sid, name: seat.name, at: Date.now() };
    hostBroadcast();
  }
  function hostBroadcast() {
    var R = host.room;
    R.seats.forEach(function (s) { if (s.kind !== 'remote') return; var c = host.conns[s.clientId]; if (c && c.open) { try { c.send(viewFor(s.sid)); } catch (e) {} } });
    hostRender(); saveHost();
  }
  function hostRender() { render(viewFor(1)); }
  function saveHost() { try { localStorage.setItem(LS_HOST, JSON.stringify({ room: host.room, saved: Date.now() })); } catch (e) {} }

  // ---- ホストのロビー操作 ----
  $('seatList').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-sid]'); if (!b || !host) return;
    var R = host.room, seat = seatBySid(+b.dataset.sid);
    if (!seat || seat.kind !== 'remote' || R.phase !== 'lobby') return;
    var doRemove = function () {
      var c = host.conns[seat.clientId]; if (c) { try { c.send({ t: 'kicked' }); } catch (x) {} setTimeout(function () { try { c.close(); } catch (x) {} }, 300); delete host.conns[seat.clientId]; }
      R.seats.splice(R.seats.indexOf(seat), 1); hostBroadcast();
    };
    if (seat.connected) confirmBox(seat.name + 'を外しますか？', '部屋から退出させます。', '外す', doRemove); else doRemove();
  });
  $('seatSeg').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-v]'); if (!b || !host || host.room.phase !== 'lobby') return;
    host.room.opts.seats = +b.dataset.v; hostBroadcast();
  });
  $('cpuList').addEventListener('change', function (e) {
    var s = e.target.closest('select[data-c]'); if (!s || !host || host.room.phase !== 'lobby') return;
    if (LV_KEYS.indexOf(s.value) >= 0) { host.room.opts.lv[+s.dataset.c] = s.value; hostBroadcast(); }
  });
  $('lvAllSeg').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-v]'); if (!b || !host || host.room.phase !== 'lobby') return;
    host.room.opts.lv = [b.dataset.v, b.dataset.v, b.dataset.v, b.dataset.v]; hostBroadcast();
  });

  $('startBtn').onclick = function () { if (host) hostStartGame(); };
  $('againBtn').onclick = function () { if (host && host.room.phase === 'end') hostStartGame(); };
  $('toLobbyBtn').onclick = function () { if (host && host.room.phase === 'end') hostToLobby('ロビーに戻りました'); };
  function copyUrl() {
    var u = $('inviteUrl').textContent;
    function legacy() { try { var ta = document.createElement('textarea'); ta.value = u; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0'; document.body.appendChild(ta); ta.select(); ta.setSelectionRange(0, u.length); var ok = document.execCommand('copy'); ta.remove(); return ok; } catch (e) { return false; } }
    var p = navigator.clipboard && window.isSecureContext ? navigator.clipboard.writeText(u) : Promise.reject();
    p.then(function () { toast('招待URLをコピーしました'); }, function () { toast(legacy() ? '招待URLをコピーしました' : 'URLを長押ししてコピーしてください'); });
  }
  $('copyBtn').onclick = copyUrl;
  $('shareBtn').onclick = function () {
    var data = { title: 'いろタイル工房', text: 'いっしょに「いろタイル工房」で遊ぼう！ 部屋コード ' + $('codeBig').textContent, url: $('inviteUrl').textContent };
    if (!navigator.share || (navigator.canShare && !navigator.canShare(data))) return copyUrl();
    try { navigator.share(data).catch(function (e) { if (!e || e.name !== 'AbortError') copyUrl(); }); } catch (e) { copyUrl(); }
  };

  var client = null;
  function startClient(code, name) {
    document.body.classList.remove('is-host');
    client = { code: code, name: name, joined: false, lastMsg: Date.now(), everJoined: false };
    connecting(true, '部屋 ' + code + ' に接続中…', 'しばらくお待ちください', function () { leaveClient(true); });
    var peer = new Peer(PEER_OPTS);
    client.peer = peer;
    if (PARTY) client.watch = setInterval(function () { if (!client) return; if (client.everJoined) { clearInterval(client.watch); return; } if (client.peer.open && !(client.conn && client.conn.open)) clientConnect(); }, FuuParty.watchMs);   // みんなの部屋：ホストより先に着いたときの取りこぼし対策
    peer.on('open', function () { clientConnect(); });
    peer.on('disconnected', function () { if (!peer.destroyed) setTimeout(function () { try { peer.reconnect(); } catch (e) {} }, 2000); });
    peer.on('error', function (e) {
      if (e.type === 'peer-unavailable') { if (PARTY && !client.everJoined && (client.ptries = (client.ptries || 0) + 1) < FuuParty.retries) { connecting(true, 'ホストを待っています…', '部屋 ' + client.code); setTimeout(clientConnect, FuuParty.retryMs); return; } if (!client.everJoined) { connecting(false); toast('部屋が見つかりません。コードを確認してください。'); leaveClient(false); } else clientLost(); }
      else if (['network', 'server-error', 'socket-error', 'socket-closed'].indexOf(e.type) >= 0) { if (!client.everJoined) connecting(true, 'サーバーに接続できません', '通信環境を確認してください。再試行しています…'); }
      else if (e.type === 'browser-incompatible') connecting(true, 'このブラウザは対応していません', 'Chrome / Safari の最新版でお試しください');
    });
    clearInterval(client.hbTimer); client.hbTimer = setInterval(clientHeartbeat, HB_MS);
    setTimeout(function () { if (client && !client.everJoined && $('connecting').classList.contains('active')) $('connText').textContent = 'つながりにくいようです。コードが正しいか、ホストが部屋を開いているか確認してください。（通信環境によっては接続できない場合があります）'; }, 15000);
  }
  function clientConnect() {
    if (!client || !client.peer || client.peer.destroyed) return;
    if (client.conn) { try { client.conn.close(); } catch (e) {} }
    var conn = client.peer.connect(hostId(client.code), { reliable: true });
    client.conn = conn;
    conn.on('open', function () { conn.send({ t: 'join', name: client.name, clientId: myId }); });
    conn.on('data', function (m) { if (client && client.conn === conn) clientOnMessage(m); });
    conn.on('close', function () { if (client && client.conn === conn) clientLost(); });
    conn.on('error', function () { if (client && client.conn === conn) clientLost(); });
  }
  function clientOnMessage(m) {
    if (!m || typeof m !== 'object') return;
    client.lastMsg = Date.now();
    if (m.t === 'welcome') { client.joined = true; client.everJoined = true; connecting(false); banner(''); sstore(SS_CLIENT, { code: client.code, name: client.name }); }
    else if (m.t === 'fuu-goto') { if (PARTY) { try { sstore(SS_CLIENT, null); } catch (e) {} FuuParty.handle(m); } } else if (m.t === 'state') { pending = ''; render(m); }
    else if (m.t === 'reject') { connecting(false); leaveClient(false); alertBox(m.msg); }
    else if (m.t === 'kicked') { sstore(SS_CLIENT, null); leaveClient(false); alertBox('ホストによって部屋から外されました。'); }
    else if (m.t === 'closed') { sstore(SS_CLIENT, null); leaveClient(false); alertBox('ホストが部屋を閉じました。'); }
    else if (m.t === 'error') { pending = ''; toast(m.msg); stageKey = ''; if (lastView) render(lastView); }
  }
  function clientHeartbeat() {
    if (!client) return;
    if (client.conn && client.conn.open) { try { client.conn.send({ t: 'ping' }); } catch (e) {} }
    if (client.everJoined && Date.now() - client.lastMsg > LOST_MS) clientLost();
  }
  function clientLost() {
    if (!client || !client.everJoined) return;
    client.joined = false; banner('ホストとの接続が切れました。再接続しています…');
    clearTimeout(client.retryT);
    client.retryT = setTimeout(function () {
      if (!client) return; client.lastMsg = Date.now();
      if (client.peer.disconnected && !client.peer.destroyed) { try { client.peer.reconnect(); } catch (e) {} }
      clientConnect();
    }, 3000);
  }
  function leaveClient(sendLeave) {
    if (!client) return;
    if (sendLeave && client.conn && client.conn.open) { try { client.conn.send({ t: 'leave' }); } catch (e) {} }
    clearInterval(client.hbTimer); clearTimeout(client.retryT);
    var p = client.peer; client = null;
    setTimeout(function () { try { p.destroy(); } catch (e) {} }, 300);
    banner(''); connecting(false); show('title'); renderTitle();
  }
  function send(m) { if (client && client.conn && client.conn.open) { client.conn.send(m); return true; } toast('接続が切れています'); return false; }

  // ---- 操作（ホストも参加者も同じ入口） ----
  var lastView = null, pending = '', stageKey = '';
  function act(m) {
    var v = lastView; if (!v || v.phase !== 'game') return;
    m.g = v.gameNo; m.n = v.g.n;
    if (host) { var err = hostAction(1, m); if (err) toast(err); return; }
    var key = m.t + ':' + m.n;
    if (pending === key) return;
    if (send(m)) pending = key;
  }
  function leaveRoom() {
    if (host) {
      confirmBox('部屋を閉じますか？', '参加者全員の接続が切れ、ゲームは終了します。', '部屋を閉じる', function () {
        Object.keys(host.conns).forEach(function (cid) { try { host.conns[cid].send({ t: 'closed' }); } catch (e) {} });
        store(LS_HOST, null);
        setTimeout(function () { try { host.peer.destroy(); } catch (e) {} location.href = location.pathname; }, 400);
      });
    } else confirmBox('部屋を出ますか？', 'ゲーム中に出た場合も、同じニックネームで入り直せば元の席に戻れます。', '部屋を出る', function () { sstore(SS_CLIENT, null); leaveClient(true); });
  }
  $('leaveBtn1').onclick = $('leaveBtn2').onclick = leaveRoom;
  $('menuBtn').onclick = function () { overlay('menuModal', true); };
  function confirmAbort() {
    confirmBox('中断してロビーに戻りますか？', 'いまのゲームを終了して、全員をこの部屋のロビーに戻します。部屋コード・参加者・設定はそのままです。', '中断してロビーへ', function () {
      if (host && host.room.phase !== 'lobby') hostToLobby('⏸️ ホストがゲームを中断しました');
    });
  }
  $('menuAbort').onclick = function () { overlay('menuModal', false); confirmAbort(); };
  $('menuReq').onclick = function () { overlay('menuModal', false); send({ t: 'lobbyReq' }); toast('ホストに「ロビーに戻りたい」と伝えました'); };
  $('menuLeave').onclick = function () { overlay('menuModal', false); leaveRoom(); };
  $('menuRules').onclick = function () { overlay('menuModal', false); overlay('rulesModal', true); };
  $('menuClose').onclick = function () { overlay('menuModal', false); };
  $('lobbyReqBar').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-lr]'); if (!b || !host) return;
    if (b.dataset.lr === 'no') { host.room.lobbyReq = null; hostBroadcast(); } else confirmAbort();
  });
  var seenNotice = null;
  function noticeUi(v) {
    if (seenNotice === null) seenNotice = v.notice ? v.notice.id : 0;
    else if (v.notice && v.notice.id !== seenNotice) { seenNotice = v.notice.id; if (v.notice.toast || !host) toast(v.notice.msg + (!v.notice.toast && v.phase === 'lobby' ? '。ロビーで次のゲームを待っています' : '')); }
    if (v.phase === 'lobby') overlay('menuModal', false);
    var bar = $('lobbyReqBar'), key = host && v.lobbyReq && v.phase !== 'lobby' ? v.lobbyReq.sid + ':' + v.lobbyReq.at : '';
    if (bar.dataset.key !== key) {
      bar.dataset.key = key;
      bar.innerHTML = key ? '<span>🙋 ' + esc(v.lobbyReq.name) + '「ロビーに戻りたい」</span><button data-lr="abort">中断してロビーへ</button><button data-lr="no" class="ghost">とじる</button>' : '';
      bar.classList.toggle('show', !!key);
    }
  }

  // =====================================================================

  // =====================================================================
  //  画面（各端末）
  // =====================================================================
  var ui = { sel: null, view: null, n: -1, gameKey: '', sumSeen: null, sayId: null, popKey: '' };
  function tileH(c, cls, attrs) { return '<i class="tl ' + (c === L.MARK ? 'mk' : 'c' + c) + (cls ? ' ' + cls : '') + '"' + (attrs || '') + (c === L.MARK ? ' aria-label="先手マーカー">🐻' : ' aria-label="' + CN[c] + '">') + '</i>'; }
  function myIndex(v) { var g = v.g; for (var p = 0; p < g.players.length; p++) if (g.players[p].kind === 'human' && g.players[p].sid === v.sid) return p; return -1; }
  function shortName(o) { return o.name; }
  function render(v) {
    lastView = v; window.__iro.view = v;
    noticeUi(v);
    if (v.phase === 'lobby') { show('lobby'); renderLobby(v); ui.n = -1; ui.sel = null; overlay('roundModal', false); return; }
    if (v.phase !== 'game') document.querySelectorAll('.bubble').forEach(function (b) { b.remove(); });
    if (v.phase === 'end') { show('end'); renderEnd(v); overlay('roundModal', false); return; }
    show('game'); renderGame(v);
  }
  function lvSelect(c, lv) { return '<select data-c="' + c + '" aria-label="ふーさんの強さ">' + LV_KEYS.map(function (k) { return '<option value="' + k + '"' + (k === lv ? ' selected' : '') + '>' + LV[k] + '</option>'; }).join('') + '</select>'; }
  function renderLobby(v) {
    var isHost = !!host, n = v.seats.length;
    $('codeBig').textContent = v.code;
    var url = inviteUrl(v.code);
    $('inviteUrl').textContent = url;
    if ($('qr').dataset.url !== url) { try { var qr = qrcode(0, 'M'); qr.addData(url); qr.make(); $('qr').innerHTML = qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true }); } catch (e) { $('qr').textContent = ''; } $('qr').dataset.url = url; }
    $('seatCount').textContent = n + ' / ' + MAX_HUMANS + '人';
    $('seatList').innerHTML = v.seats.map(function (s, i) {
      var tags = (s.kind === 'host' ? '<span class="tagx host">ホスト</span>' : '') + (i === v.you ? '<span class="tagx you">あなた</span>' : '') + (s.kind === 'remote' && !s.connected ? '<span class="tagx off">切断</span>' : '');
      return '<div class="seat' + (s.connected ? '' : ' offline') + '"><span class="av" style="background:#1f6f78">' + (i + 1) + '</span><span class="nm">' + esc(s.name) + '</span>' + tags + (isHost && s.kind === 'remote' ? '<button class="xbtn" data-sid="' + s.sid + '" aria-label="外す">×</button>' : '') + '</div>';
    }).join('');
    var total = seatTotal(v.seats, v.opts), pl = planPlayers(v.seats, v.opts);
    $('seatSeg').innerHTML = [2, 3, 4].map(function (k) { return '<button data-v="' + k + '" class="' + (k === total ? 'on' : '') + '"' + (isHost && k >= n ? '' : ' disabled') + '>' + k + '人<small>工房' + L.FACT[k] + 'つ</small></button>'; }).join('');
    $('seatSeg').classList.toggle('ro', !isHost);
    var ci = 0;
    $('cpuList').innerHTML = pl.map(function (o) {
      if (o.kind !== 'cpu') return '';
      var c = ci++;
      return '<div class="crow"><span style="font-size:20px">' + BEAR + '</span><span class="nm">' + esc(o.name) + '</span>' + (isHost ? lvSelect(c, o.lv) : '<span class="lv">' + LV[o.lv] + '</span>') + '</div>';
    }).join('');
    $('lvAllSeg').innerHTML = LV_KEYS.map(function (k) { return '<button data-v="' + k + '">' + LV[k] + '</button>'; }).join('');
    $('lvAllBox').style.display = ci ? '' : 'none';
    $('seatHint').textContent = n >= MAX_HUMANS ? '満員です（4人とも人間）' : '2〜4人で遊べます。1人でも ふーさん🐻 と対戦できます';
    $('startBtn').disabled = n < 1;
  }

  // ---- ゲーム画面 ----
  function legalRows(P, c) { var out = []; for (var r = 0; r < 5; r++) if (L.canPlace(P, r, c)) out.push(r); return out; }
  function selCount(g, sel) { var t = sel.src === 'C' ? g.center : g.factories[sel.src]; return t ? t.filter(function (x) { return x === sel.c; }).length : 0; }
  function renderGame(v) {
    var g = v.g, me = myIndex(v), gk = v.code + ':' + v.gameNo;
    if (ui.gameKey !== gk) { ui.gameKey = gk; ui.view = null; ui.sumSeen = g.summary ? g.summary.id : null; ui.sayId = g.say ? g.say.id : null; }
    if (ui.n !== g.n) { ui.n = g.n; ui.sel = null; }
    var myTurn = me >= 0 && g.turn === me && !g.over;
    if (!myTurn) ui.sel = null;
    if (ui.sel && !selCount(g, ui.sel)) ui.sel = null;
    var viewP = ui.sel ? me : (ui.view != null ? ui.view : (me >= 0 ? me : g.turn));
    if (viewP >= g.players.length) viewP = 0;
    // 上のバー
    var cur = g.players[g.turn];
    $('phLabel').textContent = g.over ? 'ゲーム終了！' : myTurn ? '🎯 あなたの番！' : esc(cur.name) + ' の番';
    $('phLabel').innerHTML = g.over ? 'ゲーム終了！' : myTurn ? '🎯 あなたの番！' : esc(cur.name) + ' の番' + (cur.kind === 'cpu' ? ' …' : '');
    $('roundChip').textContent = 'ラウンド' + g.round;
    $('players').style.setProperty('--np', g.players.length);
    $('players').innerHTML = g.players.map(function (P, p) {
      return '<div class="pc' + (p === g.turn && !g.over ? ' cur' : '') + (p === viewP ? ' viewing' : '') + (P.connected ? '' : ' off') + '" data-p="' + p + '"><span class="nm">' + (P.kind === 'cpu' && !P.sub ? '' : '') + esc(shortName(P)) + '</span>' +
        '<span class="sc">⭐' + P.score + '</span><span class="sub">' + (P.kind === 'cpu' ? LV[P.lv] : !P.connected ? '切断中' : p === me ? 'あなた' : '') + '</span>' + (g.marker === p ? '<span class="mkb">' + tileH(L.MARK) + '</span>' : '') + '</div>';
    }).join('');
    $('bagInfo').textContent = '袋 ' + g.bag + '枚・箱 ' + g.lid + '枚';
    // 工房
    $('facs').innerHTML = g.factories.map(function (f, i) {
      var hasSel = ui.sel && ui.sel.src === i;
      return '<div class="fac' + (f.length ? '' : ' empty') + (hasSel ? ' hasSel' : '') + '"><span class="no">' + (i + 1) + '</span>' + f.map(function (c) { return tileH(c, (myTurn ? 'pickable' : '') + (hasSel && ui.sel.c === c ? ' sel' : ''), ' data-src="' + i + '" data-c="' + c + '"'); }).join('') + '</div>';
    }).join('');
    // 中央（色ごとにまとめて表示）
    var cnt = [0, 0, 0, 0, 0]; g.center.forEach(function (c) { cnt[c]++; });
    var cSel = ui.sel && ui.sel.src === 'C';
    $('center').className = cSel ? 'hasSel' : '';
    $('center').innerHTML = '<span class="lbl">中央</span>' + (g.marker === 'C' ? tileH(L.MARK) : '') + cnt.map(function (k, c) { return k ? '<span class="cg' + (myTurn ? ' pickable' : '') + (cSel && ui.sel.c === c ? ' sel' : '') + '" data-src="C" data-c="' + c + '">' + tileH(c) + '×' + k + '</span>' : ''; }).join('') + (g.center.length || g.marker === 'C' ? '' : '<span class="lbl">（空）</span>');
    // 状態
    var st = $('status'), sh = '';
    st.classList.toggle('mine', myTurn);
    if (g.over) sh = '🎉 最後のラウンドが終わりました！ 結果発表…';
    else if (myTurn && ui.sel) { var k = selCount(g, ui.sel); sh = tileH(ui.sel.c, '', ' style="--ts:20px"') + ' ' + CN[ui.sel.c] + '×' + k + (ui.sel.src === 'C' && g.marker === 'C' ? '（＋先手🐻）' : '') + ' → 置く段をタップ <button id="cancelSel">✕ やめる</button>'; }
    else if (myTurn) sh = '工房か中央のタイルをタップしてね（1色ぜんぶ取ります）';
    else if (v.g.pause > 0) sh = '次のラウンドの準備中…';
    else sh = esc(cur.name) + ' が考えています…' + (host && g.curOff ? ' <button class="main" id="subBtn">' + BEAR + ' 代打ちしてもらう</button>' : g.curOff ? '（切断中）' : '');
    st.innerHTML = sh;
    renderBoard(g, viewP, me, myTurn);
    // ログ
    var lk = gk + ':' + (g.log.length ? g.log[g.log.length - 1].id : 0);
    if ($('lines').dataset.k !== lk) { $('lines').dataset.k = lk; $('lines').innerHTML = g.log.slice(-3).reverse().map(function (l) { return '<div class="line">' + esc(l.text) + '</div>'; }).join(''); }
    // ふーさんのひとこと
    if (g.say && g.say.id !== ui.sayId) { ui.sayId = g.say.id; var b = document.createElement('div'); b.className = 'bubble'; b.textContent = shortName(g.players[g.say.p]) + '「' + g.say.text + '」'; document.body.appendChild(b); setTimeout(function () { b.remove(); }, 3000); }
    // ラウンド結果
    if (g.summary && g.summary.id !== ui.sumSeen) { ui.sumSeen = g.summary.id; showSummary(g); }
  }
  function renderBoard(g, p, me, myTurn) {
    var P = g.players[p], sel = myTurn && ui.sel && p === me ? ui.sel : null, ok = sel ? legalRows(P, sel.c) : [], k = sel ? selCount(g, sel) : 0;
    var popK = g.summary ? g.summary.id : 0, pop = {};
    if (g.summary && ui.popKey !== ui.gameKey + ':' + popK + ':' + p) { ui.popKey = ui.gameKey + ':' + popK + ':' + p; (g.summary.players[p] || { placed: [] }).placed.forEach(function (x) { pop[x.r + ',' + x.col] = 1; }); }
    var h = '<div class="bhead">' + (p === me ? '🧱 あなたのボード' : '👀 ' + esc(P.name) + ' のボード') + '<span class="sc">⭐ ' + P.score + '点</span></div><div class="pboard"><div class="plines">';
    for (var r = 0; r < 5; r++) {
      var Ln = P.lines[r], cls = sel ? (ok.indexOf(r) >= 0 ? ' ok' : ' no') : '', badge = '';
      if (sel && ok.indexOf(r) >= 0) { var fit = Math.min(k, r + 1 - Ln.n), over = k - fit; badge = '<span class="badge' + (over ? ' bad' : '') + '">+' + fit + (over ? ' 床' + over : '') + '</span>'; }
      h += '<div class="pl' + cls + '" data-row="' + r + '">' + badge;
      for (var i = r; i >= 0; i--) h += i < Ln.n ? tileH(Ln.c) : '<i class="slot"></i>';
      h += '</div>';
    }
    h += '</div><div class="wall">';
    for (r = 0; r < 5; r++) { h += '<div class="wrow">'; for (var c = 0; c < 5; c++) { var col = L.wallColor(r, c); h += P.wall[r][c] ? tileH(col, pop[r + ',' + c] ? 'pop' : '') : tileH(col, 'ghost'); } h += '</div>'; }
    h += '</div></div><div class="floorRow' + (sel ? ' ok' : '') + '" data-row="-1"><span class="flab">床</span>';
    for (var f = 0; f < 7; f++) h += '<span class="fl">' + (f < P.floor.length ? tileH(P.floor[f]) : '<i class="slot"></i>') + '−' + L.FLOOR[f] + '</span>';
    h += (sel ? '<span class="badge" style="position:static;background:var(--ng);color:#fff;font-size:10.5px;font-weight:900;padding:1px 6px;border-radius:8px;align-self:center">全部床へ</span>' : '') + '</div>';
    var pen = L.floorPenalty(P.floor.length);
    h += '<div class="bfoot"><span>' + (pen ? '床の減点 −' + pen : '床はきれい✨') + '</span><span>' + (p === me ? '' : 'チップをタップで切替') + '</span></div>';
    $('boardCard').innerHTML = h;
  }
  function showSummary(g) {
    var s = g.summary;
    $('rmTitle').textContent = 'ラウンド' + s.round + ' のけっか' + (s.over ? '（最終）' : '');
    $('rmBody').innerHTML = s.players.map(function (x, p) {
      var P = g.players[p];
      return '<div class="rsum"><span class="nm">' + esc(shortName(P)) + '</span>' + (x.placed.length ? x.placed.map(function (y) { return tileH(y.c) + '<span class="pt">+' + y.pts + '</span>'; }).join('') : '<span style="opacity:.5">壁なし</span>') +
        (x.pen ? '<span class="pen">床 −' + x.pen + '</span>' : '') + '<span class="tot">' + (x.delta >= 0 ? '+' : '') + x.delta + ' → ' + (s.over && g.final ? g.final[p].base : P.score) + '点</span></div>';
    }).join('');
    overlay('roundModal', true);
    clearTimeout(ui.sumT); ui.sumT = setTimeout(function () { overlay('roundModal', false); }, T.sumShow);
  }
  $('rmClose').onclick = function () { overlay('roundModal', false); };
  $('roundModal').addEventListener('click', function (e) { if (e.target === this) overlay('roundModal', false); });
  $('players').addEventListener('click', function (e) {
    var c = e.target.closest('.pc[data-p]'); if (!c || !lastView) return;
    ui.view = +c.dataset.p; ui.sel = null; renderGame(lastView);
  });
  document.querySelector('#game .market').addEventListener('click', function (e) {
    var t = e.target.closest('[data-src]'); if (!t || !lastView || !lastView.g) return;
    var v = lastView, me = myIndex(v); if (me < 0 || v.g.turn !== me || v.g.over) return;
    var src = t.dataset.src === 'C' ? 'C' : +t.dataset.src, c = +t.dataset.c;
    ui.sel = ui.sel && ui.sel.src === src && ui.sel.c === c ? null : { src: src, c: c };
    renderGame(v);
  });
  $('boardCard').addEventListener('click', function (e) {
    var r = e.target.closest('[data-row]'); if (!r || !ui.sel || !lastView) return;
    var row = +r.dataset.row, v = lastView, me = myIndex(v);
    if (row >= 0 && !L.canPlace(v.g.players[me], row, ui.sel.c)) { toast('その段には置けません'); return; }
    var s = ui.sel; ui.sel = null;
    act({ t: 'take', src: s.src, c: s.c, row: row });
    renderGame(v);
  });
  $('status').addEventListener('click', function (e) {
    if (e.target.id === 'cancelSel') { ui.sel = null; renderGame(lastView); }
    if (e.target.id === 'subBtn' && host) hostSubstitute();
  });
  // ---- 結果 ----
  function miniWall(P) { var h = '<div class="g">'; for (var r = 0; r < 5; r++) for (var c = 0; c < 5; c++) h += tileH(L.wallColor(r, c), P.wall[r][c] ? '' : 'ghost'); return h + '</div>'; }
  function renderEnd(v) {
    var g = v.g, rk = g.ranking || [], fin = g.final || [];
    $('rankList').innerHTML = rk.map(function (x) {
      var P = g.players[x.p], b = fin[x.p] || { base: P.score, rows: 0, cols: 0, colors: 0 };
      return '<div class="rk' + (x.rank === 1 ? ' first' : '') + '"><span class="md">' + (['🥇', '🥈', '🥉'][x.rank - 1] || x.rank) + '</span><span class="nm">' + esc(P.name) + (P.kind === 'cpu' ? ' <span class="lv" style="font-size:10px;padding:1px 6px;border-radius:99px;background:#f2ead8">' + LV[P.lv] + '</span>' : '') +
        '<small>壁 ' + b.base + '点 ＋横列' + b.rows + '×2 ＋縦列' + b.cols + '×7 ＋色' + b.colors + '×10</small></span><span class="sc">' + P.score + '</span></div>';
    }).join('') + (rk.length > 1 && rk[0].rank === 1 && rk[1].rank !== 1 && g.players[rk[0].p].kind === 'cpu' ? '<p class="mid">' + BEAR + '「ふーさんの宮殿、完成クマ〜！」</p>' : rk.length > 1 && rk[1].rank === 1 ? '<p class="mid">同点！ なかよく優勝クマ' + BEAR + '</p>' : '');
    $('endWalls').innerHTML = g.players.map(function (P) { return '<div class="mw">' + esc(shortName(P)) + ' ⭐' + P.score + miniWall(P) + '</div>'; }).join('');
    $('leaveBtn2').textContent = host ? '🚪 部屋を閉じる' : '🚪 部屋を出る';
  }

  function renderTitle() {
    if (!$('nameIn').value) $('nameIn').value = load(LS_NAME) || '';
    var inv = normCode(Q.get('room'));
    $('inviteJoinBox').style.display = inv.length === 4 ? '' : 'none';
    $('invCode').textContent = inv;
    if (inv.length === 4) $('codeIn').value = inv;
    var saved = load(LS_HOST, true), ok = saved && saved.room && Date.now() - saved.saved < 12 * 3600 * 1000;
    $('resumeBtn').style.display = ok ? '' : 'none';
    if (ok) $('resumeBtn').textContent = '前回の部屋（' + saved.room.code + '）を再開する';
    var joined = sload(SS_CLIENT);
    $('rejoinBtn').style.display = joined ? '' : 'none';
    if (joined) $('rejoinBtn').textContent = '部屋 ' + joined.code + ' に戻る（' + joined.name + '）';
  }
  function getName() {
    var n = cleanName($('nameIn').value);
    if (!n) { toast('ニックネームを入力してください'); $('nameIn').focus(); return null; }
    store(LS_NAME, n); return n;
  }
  $('createBtn').onclick = function () { var n = getName(); if (n) { store(LS_HOST, null); startHost(n, null); } };
  $('resumeBtn').onclick = function () { var saved = load(LS_HOST, true); if (!saved) return; startHost(saved.room.seats[0].name, saved.room); host.resuming = true; };
  function join(code) {
    var n = getName(); if (!n) return;
    code = normCode(code);
    if (code.length !== 4) { toast('4文字の部屋コードを入力してください'); return; }
    startClient(code, n);
  }
  $('joinBtn').onclick = function () { join($('codeIn').value); };
  $('joinInvitedBtn').onclick = function () { join(Q.get('room')); };
  $('rejoinBtn').onclick = function () { var j = sload(SS_CLIENT); if (j) { $('nameIn').value = j.name; startClient(j.code, j.name); } };
  $('codeIn').addEventListener('input', function () { this.value = normCode(this.value); });
  if (location.protocol === 'file:') setTimeout(function () { toast('ファイルを直接開いています。招待URLは公開URL（https）でのみ使えます。'); }, 500);

  // ---- ページ全体の引っぱり（バウンス・プルで閉じる・プルで再読み込み）を止める ----
  // 古い iOS は overscroll-behavior が効かないので、スクロールできる要素の中で「その向きにまだ動ける」ときだけ許可する
  var touch0 = null;
  document.addEventListener('touchstart', function (e) { if (e.touches.length === 1) touch0 = { x: e.touches[0].clientX, y: e.touches[0].clientY }; }, { passive: true });
  document.addEventListener('touchmove', function (e) {
    if (!e.cancelable) return;
    if (e.touches.length > 1) { if (!e.target.closest || !e.target.closest('#__none')) e.preventDefault(); return; }   // 盤の外のピンチ（ページ拡大）は止める
    if (!touch0) return;
    var t = e.touches[0], dx = t.clientX - touch0.x, dy = t.clientY - touch0.y, ax = Math.abs(dx), ay = Math.abs(dy);
    if (!ax && !ay) return;
    for (var el = e.target; el && el.nodeType === 1 && el !== document.body; el = el.parentElement) {
      var cs = getComputedStyle(el);
      var canV = ay >= ax * 0.5 && /(auto|scroll)/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 1 && ((dy > 0 && el.scrollTop > 0) || (dy < 0 && el.scrollTop + el.clientHeight < el.scrollHeight - 1));
      var canH = ax >= ay * 0.5 && /(auto|scroll)/.test(cs.overflowX) && el.scrollWidth > el.clientWidth + 1 && ((dx > 0 && el.scrollLeft > 0) || (dx < 0 && el.scrollLeft + el.clientWidth < el.scrollWidth - 1));
      if (canV || canH) return;
    }
    e.preventDefault();
  }, { passive: false });
  // テスト用：自動で打つ（window.__iro.autoplay = true）
  setInterval(function () {
    var v = lastView; if (!window.__iro.autoplay || !v || v.phase !== 'game' || !v.g || pending) return;
    var me = myIndex(v); if (me < 0 || v.g.turn !== me || v.g.over) return;
    var ms = L.legalMoves({ factories: v.g.factories, center: v.g.center, players: v.g.players }, me);
    var good = ms.filter(function (m) { return m.row >= 0; }), pool = good.length ? good : ms;
    if (pool.length) { var m = pool[Math.floor(Math.random() * pool.length)]; act({ t: 'take', src: m.src, c: m.c, row: m.row }); }
  }, 80);
  // テスト・デバッグ用
  window.__iro = { view: null, autoplay: false, ui: ui, act: function (m) { act(m); }, role: function () { return host ? 'host' : client ? 'client' : 'none'; }, hostRoom: function () { return host ? host.room : null; } };
  renderTitle();

  // ---- ひろばの「みんなの部屋」：同じメンバーで自動入室＋ホストは「つぎのゲーム」 ----
  if (PARTY) {
    FuuParty.init({ game: 'iro-tile-koubou',
      isHost: function () { return !!host && !host.room.solo; },
      inGame: function () { var R = host && host.room; return !!R && ['lobby', 'end', 'over', 'result'].indexOf(R.phase) < 0 && !(R.G && (R.G.over || R.G.phase === 'end' || R.G.phase === 'over')); },
      broadcast: function (m) { if (host) Object.keys(host.conns).forEach(function (cid) { try { host.conns[cid].send(m); } catch (e) {} }); } });
    FuuParty.status = function () { return host ? { host: 1, n: Object.keys(host.conns).filter(function (k) { return host.conns[k].open; }).length } : { host: 0, joined: !!(client && client.everJoined) }; };
    $('nameIn').value = cleanName(PARTY.name) || 'ななし';
    setTimeout(function () {
      if (PARTY.host) { store(LS_HOST, null); startHost(cleanName(PARTY.name) || 'ホスト', null); }
      else startClient(PARTY.code, cleanName(PARTY.name) || 'ななし');
    }, 50);
  }
})();
