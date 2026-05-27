const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const httpServer = http.createServer(app);
const io = new Server(httpServer);
app.use(express.static(path.join(__dirname)));

const rooms = {};

const spyRooms = {};

const SPY_LOCATIONS = [
  { name: '✈️ สนามบิน',        roles: ['นักบิน','แอร์โฮสเตส','ผู้โดยสาร','เจ้าหน้าที่ศุลกากร','พนักงานเช็คอิน','รปภ.'] },
  { name: '🍽️ ร้านอาหาร',     roles: ['เชฟ','บริกร','ลูกค้า','เจ้าของร้าน','พนักงานเสิร์ฟ','บาร์เทนเดอร์'] },
  { name: '🏥 โรงพยาบาล',      roles: ['แพทย์','พยาบาล','คนไข้','ผู้มาเยี่ยม','เภสัชกร','พนักงานต้อนรับ'] },
  { name: '🏫 โรงเรียน',       roles: ['ครู','นักเรียน','ผู้อำนวยการ','ภารโรง','นักการ','ผู้ปกครอง'] },
  { name: '🏖️ ชายหาด',        roles: ['นักท่องเที่ยว','ไลฟ์การ์ด','คนขายของ','นักดำน้ำ','ช่างภาพ','พนักงานรีสอร์ท'] },
  { name: '🎬 โรงภาพยนตร์',    roles: ['ผู้ชม','คนขายตั๋ว','พนักงานป๊อปคอร์น','ผู้กำกับ','นักแสดง','พนักงานทำความสะอาด'] },
  { name: '🛒 ซูเปอร์มาร์เก็ต', roles: ['แคชเชียร์','ลูกค้า','พนักงานสต็อก','เจ้าของ','นักขาย','รปภ.'] },
  { name: '🚔 สถานีตำรวจ',      roles: ['ตำรวจ','นักสืบ','ผู้ต้องหา','ทนายความ','พยาน','เจ้าหน้าที่ธุรการ'] },
  { name: '🦁 สวนสัตว์',       roles: ['ผู้เยี่ยมชม','ผู้ดูแลสัตว์','ไกด์นำเที่ยว','ช่างภาพ','สัตวแพทย์','พนักงานขายตั๋ว'] },
  { name: '💪 ยิม',            roles: ['เทรนเนอร์','สมาชิก','พนักงานต้อนรับ','นักกีฬา','ผู้จัดการ','นักโภชนาการ'] },
  { name: '🎵 คอนเสิร์ต',      roles: ['นักร้อง','แฟนคลับ','รปภ.','ช่างเสียง','ช่างภาพ','พิธีกร'] },
  { name: '🛕 วัด',            roles: ['พระสงฆ์','นักท่องเที่ยว','คนมาทำบุญ','มัคนายก','เจ้าอาวาส','ช่างภาพ'] },
  { name: '🏦 ธนาคาร',         roles: ['พนักงานธนาคาร','ลูกค้า','รปภ.','ผู้จัดการ','นักบัญชี','ผู้ตรวจสอบ'] },
  { name: '🏟️ สนามกีฬา',      roles: ['นักกีฬา','แฟนบอล','ผู้ตัดสิน','ผู้บรรยาย','พนักงานขายน้ำ','โค้ช'] },
  { name: '💆 สปา',            roles: ['นักนวด','ลูกค้า','พนักงานต้อนรับ','ผู้จัดการ','นักอโรมา','พนักงานทำผม'] },
  { name: '🚢 เรือสำราญ',      roles: ['กัปตัน','ผู้โดยสาร','พนักงานบริการ','นักดนตรี','พ่อครัว','แพทย์ประจำเรือ'] },
  { name: '🎡 สวนสนุก',        roles: ['ผู้เยี่ยมชม','พนักงานเครื่องเล่น','มาสคอต','พนักงานขายอาหาร','ช่างซ่อม','ผู้จัดการ'] },
  { name: '🏛️ พิพิธภัณฑ์',    roles: ['ไกด์นำเที่ยว','นักท่องเที่ยว','ภัณฑารักษ์','นักประวัติศาสตร์','ช่างภาพ','นักศึกษา'] },
  { name: '🏕️ ค่ายพักแรม',    roles: ['หัวหน้าค่าย','นักเดินป่า','ครู','นักเรียน','ช่างภาพ','แพทย์'] },
  { name: '🎭 โรงละคร',        roles: ['นักแสดง','ผู้กำกับ','ผู้ชม','ช่างแสง','ช่างเสียง','พนักงานขายตั๋ว'] },
];

function genSpyCode() {
  let c;
  do { c = Math.random().toString(36).slice(2, 6).toUpperCase(); } while (spyRooms[c] || rooms[c]);
  return c;
}

function startSpyVote(room) {
  room.phase = 'voting';
  room.votes = {};
  io.to('spy:' + room.code).emit('spy:vote-start', { players: room.players });
}

function resolveSpyVote(room) {
  const tally = {};
  Object.values(room.votes).forEach(id => { tally[id] = (tally[id] || 0) + 1; });
  let maxVotes = 0, topId = null;
  Object.entries(tally).forEach(([id, cnt]) => { if (cnt > maxVotes) { maxVotes = cnt; topId = id; } });
  const caught = topId === room.spyId;
  if (caught) {
    room.phase = 'spy-guess';
    const spyName = room.players.find(p => p.id === room.spyId)?.name;
    io.to('spy:' + room.code).emit('spy:caught', { spyId: room.spyId, spyName, locations: SPY_LOCATIONS.map(l => l.name) });
  } else {
    room.phase = 'gameover';
    const wrongName = room.players.find(p => p.id === topId)?.name || '?';
    io.to('spy:' + room.code).emit('spy:gameover', {
      winner: 'spy', spyId: room.spyId, location: room.location.name,
      reason: `โหวตจับ "${wrongName}" ผิดคน — สายลับชนะ!`, players: room.players,
    });
  }
}

const DISCUSS_SEC = 90; // discussion time before voting opens
const CONFIRM_SEC = 30; // confirmation time after vote tallied

// ── Helpers ──────────────────────────────────────────────────────────────────

function genCode() {
  let c;
  do { c = Math.random().toString(36).slice(2, 6).toUpperCase(); } while (rooms[c]);
  return c;
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function getMajority(votes) {
  const tally = {};
  Object.values(votes).forEach(id => { tally[id] = (tally[id] || 0) + 1; });
  let target = null, maxV = 0;
  Object.entries(tally).forEach(([id, cnt]) => { if (cnt > maxV) { maxV = cnt; target = id; } });
  return target;
}

function buildRoles(n) {
  const roles = [];
  const wolves = n <= 6 ? 1 : n <= 9 ? 2 : 3;
  for (let i = 0; i < wolves; i++) roles.push('werewolf');
  roles.push('seer');
  if (n >= 5)              roles.push('bodyguard');
  if (n >= 7)              roles.push('hunter');
  if (n >= 8)              roles.push('mason', 'mason');
  if (n >= 9)              roles.push('witch');
  if (wolves >= 2 && n >= 8) roles.push('minion');
  while (roles.length < n) roles.push('villager');
  return shuffle(roles);
}

function alivePlaying(room) {
  return room.players.filter(p => p.alive);
}

function aliveSummary(room) {
  return alivePlaying(room).map(p => ({ id: p.id, name: p.name }));
}

function checkWin(room) {
  const alive = alivePlaying(room);
  const wolves = alive.filter(p => p.role === 'werewolf').length;
  const good   = alive.length - wolves;
  if (wolves === 0)   return 'villager';
  if (wolves >= good) return 'werewolf';
  return null;
}

// ── Night ─────────────────────────────────────────────────────────────────────

function buildNightPending(room) {
  const p = new Set();
  if (room.players.some(p => p.role === 'werewolf' && p.alive)) p.add('werewolf');
  if (room.players.some(p => p.role === 'seer'      && p.alive)) p.add('seer');
  if (room.players.some(p => p.role === 'bodyguard' && p.alive)) p.add('bodyguard');
  return p;
}

function witchHasAction(room) {
  const witch = room.players.find(p => p.role === 'witch' && p.alive);
  return witch && (!room.witchUsedSave || !room.witchUsedKill);
}

function checkNightResolution(room) {
  if (room.nightPending.size === 0 && !room.witchWaiting) {
    setTimeout(() => resolveNight(room), 1000);
  }
}

function startNight(room) {
  clearTimeout(room.discussionTimer);
  clearTimeout(room.confirmTimer);

  room.phase = 'night';
  room.nightActions = {};
  room.wolfVotes    = {};
  room.witchWaiting = false;

  io.to(room.code).emit('night-start', {
    day: room.day,
    isFirstNight: room.day === 1,
    players: aliveSummary(room),
  });

  if (room.day === 1) {
    room.nightPending = new Set();
    setTimeout(() => {
      if (room.phase === 'night' && room.day === 1) startDay(room, []);
    }, 15000);
    return;
  }

  room.nightPending = buildNightPending(room);
  if (room.nightPending.size === 0) setTimeout(() => resolveNight(room), 2000);
}

function resolveNight(room) {
  if (room.phase !== 'night') return;

  const wolfTarget    = getMajority(room.wolfVotes);
  const witchSave     = room.nightActions.witchSave  || null;
  const witchKill     = room.nightActions.witchKill  || null;
  const bodyguardSave = room.nightActions.bodyguard  || null;

  const eliminated = [];

  if (wolfTarget && wolfTarget !== witchSave && wolfTarget !== bodyguardSave) {
    const p = room.players.find(p => p.id === wolfTarget && p.alive);
    if (p) { p.alive = false; eliminated.push(p); }
  }
  if (witchKill) {
    const p = room.players.find(p => p.id === witchKill && p.alive);
    if (p) { p.alive = false; eliminated.push(p); }
  }

  room.day++;
  triggerOrStartDay(room, eliminated);
}

// ── Day ───────────────────────────────────────────────────────────────────────

function startDay(room, eliminated) {
  clearTimeout(room.discussionTimer);
  room.phase = 'day';
  room.votes = {};

  const winner = checkWin(room);
  if (winner) { endGame(room, winner); return; }

  const discSec = room.discussSec || DISCUSS_SEC;
  io.to(room.code).emit('day-start', {
    day: room.day,
    eliminated: eliminated.map(p => ({ id: p.id, name: p.name, role: p.role })),
    players: aliveSummary(room),
    discussionSec: discSec,
  });

  // Auto-open voting after discussion timer
  room.discussionTimer = setTimeout(() => {
    if (room.phase === 'day') openVoting(room);
  }, discSec * 1000);
}

function openVoting(room) {
  if (room.phase !== 'day') return;
  room.phase  = 'voting';
  room.votes  = {};
  io.to(room.code).emit('vote-open', { players: aliveSummary(room) });
}

function startConfirmation(room) {
  const tally = {};
  Object.values(room.votes).forEach(id => { tally[id] = (tally[id] || 0) + 1; });

  const maxV = Math.max(0, ...Object.values(tally));
  const tied = Object.entries(tally).filter(([, c]) => c === maxV);

  // Tied → skip confirmation, go straight to no-kill
  if (tied.length !== 1) {
    io.to(room.code).emit('vote-result', { eliminated: null, tied: true, tannerWin: false });
    const winner = checkWin(room);
    if (winner) { setTimeout(() => endGame(room, winner), 3000); return; }
    room.day++;
    setTimeout(() => startNight(room), 4000);
    return;
  }

  const proposedPlayer = room.players.find(p => p.id === tied[0][0] && p.alive);
  room.phase          = 'confirming';
  room.confirmVotes   = {};
  room.proposedTarget = proposedPlayer || null;

  io.to(room.code).emit('confirm-request', {
    target: proposedPlayer ? { id: proposedPlayer.id, name: proposedPlayer.name } : null,
    confirmSec: CONFIRM_SEC,
  });

  // Auto-resolve if time runs out
  room.confirmTimer = setTimeout(() => {
    if (room.phase === 'confirming') resolveConfirmation(room);
  }, CONFIRM_SEC * 1000);
}

function resolveConfirmation(room) {
  if (room.phase !== 'confirming') return;
  clearTimeout(room.confirmTimer);

  const yesCount = Object.values(room.confirmVotes).filter(v => v === true).length;
  const noCount  = Object.values(room.confirmVotes).filter(v => v === false).length;
  const doKill   = yesCount > noCount;

  let eliminated = null;
  if (doKill && room.proposedTarget) {
    const p = room.players.find(p => p.id === room.proposedTarget.id && p.alive);
    if (p) { p.alive = false; eliminated = p; }
  }

  // Tanner special win
  if (eliminated?.role === 'tanner') {
    io.to(room.code).emit('vote-result', {
      eliminated: { id: eliminated.id, name: eliminated.name, role: eliminated.role },
      tied: false, tannerWin: true,
      confirmStats: { yes: yesCount, no: noCount },
    });
    setTimeout(() => endGame(room, 'tanner'), 4000);
    return;
  }

  io.to(room.code).emit('vote-result', {
    eliminated: eliminated ? { id: eliminated.id, name: eliminated.name, role: eliminated.role } : null,
    tied: false,
    tannerWin: false,
    notConfirmed: !doKill && !!room.proposedTarget,
    confirmStats: { yes: yesCount, no: noCount },
  });

  const afterVote = () => {
    const winner = checkWin(room);
    if (winner) { setTimeout(() => endGame(room, winner), 3000); return; }
    room.day++;
    setTimeout(() => startNight(room), 4000);
  };

  if (eliminated?.role === 'hunter') {
    setTimeout(() => activateHunters(room, [eliminated], afterVote), 2000);
  } else {
    afterVote();
  }
}

// ── Hunter ────────────────────────────────────────────────────────────────────

function triggerOrStartDay(room, eliminated) {
  const hunters = eliminated.filter(p => p.role === 'hunter');
  if (hunters.length > 0) {
    activateHunters(room, hunters, () => startDay(room, eliminated));
  } else {
    startDay(room, eliminated);
  }
}

function activateHunters(room, hunters, onDone) {
  room.phase        = 'hunter-shooting';
  room.huntersPending = new Set(hunters.map(h => h.id));
  room.hunterOnDone = onDone;
  hunters.forEach(h => {
    io.to(h.id).emit('hunter-shoot', { players: aliveSummary(room).filter(p => p.id !== h.id) });
  });
  io.to(room.code).emit('hunter-shooting', { names: hunters.map(h => h.name) });
}

// ── End game ──────────────────────────────────────────────────────────────────

function endGame(room, winner) {
  room.phase = 'ended';
  io.to(room.code).emit('game-over', {
    winner,
    players: room.players.map(p => ({ id: p.id, name: p.name, role: p.role, alive: p.alive })),
  });
}

// ── Socket.io ─────────────────────────────────────────────────────────────────

io.on('connection', socket => {

  socket.on('create-room', ({ name, discussSec }) => {
    const code = genCode();
    const player = { id: socket.id, name: name.trim().slice(0, 15), role: null, alive: true, isHost: true };
    const discSec = Math.max(10, Math.min(600, parseInt(discussSec) || DISCUSS_SEC));
    rooms[code] = {
      code, players: [player], phase: 'lobby', day: 0,
      discussSec: discSec,
      nightActions: {}, wolfVotes: {}, nightPending: new Set(),
      votes: {}, confirmVotes: {}, proposedTarget: null,
      witchUsedSave: false, witchUsedKill: false, witchWaiting: false,
      discussionTimer: null, confirmTimer: null,
    };
    socket.join(code);
    socket.roomCode = code;
    socket.emit('room-created', { code, players: rooms[code].players, playerId: socket.id });
  });

  socket.on('join-room', ({ code, name }) => {
    const room = rooms[code?.toUpperCase()];
    if (!room)                  return socket.emit('join-error', '❌ ไม่พบห้องนี้');
    if (room.phase !== 'lobby') return socket.emit('join-error', '❌ เกมเริ่มแล้ว');
    if (room.players.length >= 12) return socket.emit('join-error', '❌ ห้องเต็ม (สูงสุด 12 คน)');

    const player = { id: socket.id, name: name.trim().slice(0, 15), role: null, alive: true, isHost: false };
    room.players.push(player);
    socket.join(code.toUpperCase());
    socket.roomCode = code.toUpperCase();

    socket.emit('joined-room', { code: code.toUpperCase(), players: room.players, playerId: socket.id });
    socket.to(code.toUpperCase()).emit('lobby-update', { players: room.players });
  });

  socket.on('restart-game', () => {
    const room = rooms[socket.roomCode];
    if (!room || room.phase !== 'ended') return;
    if (!room.players.find(p => p.id === socket.id && p.isHost)) return;

    clearTimeout(room.discussionTimer);
    clearTimeout(room.confirmTimer);
    room.phase = 'lobby'; room.day = 0;
    room.nightActions = {}; room.wolfVotes = {}; room.nightPending = new Set();
    room.votes = {}; room.confirmVotes = {}; room.proposedTarget = null;
    room.witchUsedSave = false; room.witchUsedKill = false; room.witchWaiting = false;
    room.discussionTimer = null; room.confirmTimer = null;
    room.players.forEach(p => { p.role = null; p.alive = true; });

    io.to(room.code).emit('game-restarted', { players: room.players });
  });

  socket.on('start-game', () => {
    const room = rooms[socket.roomCode];
    if (!room) return;
    const host = room.players.find(p => p.id === socket.id && p.isHost);
    if (!host) return;
    if (room.players.length < 4) return socket.emit('join-error', '❌ ต้องมีผู้เล่นอย่างน้อย 4 คน');

    const roles = buildRoles(room.players.length);
    room.players.forEach((p, i) => { p.role = roles[i]; p.alive = true; });
    room.day = 1;

    room.players.forEach(p => {
      let teammates = [];
      if (p.role === 'werewolf')
        teammates = room.players.filter(pp => pp.role === 'werewolf' && pp.id !== p.id).map(pp => ({ id: pp.id, name: pp.name }));
      else if (p.role === 'mason')
        teammates = room.players.filter(pp => pp.role === 'mason'    && pp.id !== p.id).map(pp => ({ id: pp.id, name: pp.name }));
      else if (p.role === 'minion')
        teammates = room.players.filter(pp => pp.role === 'werewolf').map(pp => ({ id: pp.id, name: pp.name }));

      io.to(p.id).emit('game-started', {
        role: p.role, teammates,
        allPlayers: room.players.map(pp => ({ id: pp.id, name: pp.name })),
      });
    });

    setTimeout(() => startNight(room), 8000);
  });

  // ── Night actions ────────────────────────────────────────────────────────────

  socket.on('night-action', ({ targetId }) => {
    const room = rooms[socket.roomCode];
    if (!room || room.phase !== 'night') return;
    const player = room.players.find(p => p.id === socket.id && p.alive);
    if (!player) return;

    const aliveWolves = room.players.filter(p => p.role === 'werewolf' && p.alive);

    if (player.role === 'werewolf') {
      if (room.wolfVotes[socket.id]) return;
      room.wolfVotes[socket.id] = targetId;

      const targetName = room.players.find(p => p.id === targetId)?.name;
      aliveWolves.filter(w => w.id !== socket.id).forEach(w =>
        io.to(w.id).emit('wolf-vote-update', { voterName: player.name, targetName })
      );

      if (Object.keys(room.wolfVotes).length >= aliveWolves.length) {
        room.nightPending.delete('werewolf');
        room.nightActions.wolfTarget = getMajority(room.wolfVotes);

        if (witchHasAction(room)) {
          room.witchWaiting = true;
          const witch  = room.players.find(p => p.role === 'witch' && p.alive);
          const target = room.players.find(p => p.id === room.nightActions.wolfTarget);
          io.to(witch.id).emit('witch-notify', {
            wolfTarget: target ? { id: target.id, name: target.name } : null,
            hasSavePotion: !room.witchUsedSave,
            hasKillPotion: !room.witchUsedKill,
          });
        }
      }
    } else if (player.role === 'seer') {
      if (!room.nightPending.has('seer')) return;
      const target = room.players.find(p => p.id === targetId);
      if (target) socket.emit('seer-result', { targetName: target.name, isWerewolf: target.role === 'werewolf' });
      room.nightPending.delete('seer');
    } else if (player.role === 'bodyguard') {
      if (!room.nightPending.has('bodyguard')) return;
      room.nightActions.bodyguard = targetId;
      room.nightPending.delete('bodyguard');
    }

    checkNightResolution(room);
  });

  socket.on('witch-action', ({ action, targetId }) => {
    const room = rooms[socket.roomCode];
    if (!room || room.phase !== 'night') return;
    const player = room.players.find(p => p.id === socket.id && p.role === 'witch' && p.alive);
    if (!player) return;

    if (action === 'save' && !room.witchUsedSave) {
      room.nightActions.witchSave = room.nightActions.wolfTarget;
      room.witchUsedSave = true;
    } else if (action === 'kill' && !room.witchUsedKill && targetId) {
      room.nightActions.witchKill = targetId;
      room.witchUsedKill = true;
    }
    room.witchWaiting = false;
    checkNightResolution(room);
  });

  // ── Day vote ─────────────────────────────────────────────────────────────────

  socket.on('vote', ({ targetId }) => {
    const room = rooms[socket.roomCode];
    if (!room || room.phase !== 'voting') return;

    const player = room.players.find(p => p.id === socket.id && p.alive);
    if (!player || room.votes[socket.id]) return;

    room.votes[socket.id] = targetId;
    const aliveCount = alivePlaying(room).length;

    io.to(room.code).emit('vote-update', {
      votes: room.votes,
      voteCount: Object.keys(room.votes).length,
      aliveCount,
    });

    if (Object.keys(room.votes).length >= aliveCount) {
      room.phase = 'tallying';
      setTimeout(() => startConfirmation(room), 1000);
    }
  });

  // ── Confirmation ─────────────────────────────────────────────────────────────

  socket.on('confirm-kill', ({ confirm }) => {
    const room = rooms[socket.roomCode];
    if (!room || room.phase !== 'confirming') return;

    const player = room.players.find(p => p.id === socket.id && p.alive);
    if (!player || room.confirmVotes[socket.id] !== undefined) return;

    room.confirmVotes[socket.id] = !!confirm;
    const aliveCount = alivePlaying(room).length;
    const yesCount   = Object.values(room.confirmVotes).filter(v => v).length;
    const noCount    = Object.values(room.confirmVotes).filter(v => !v).length;
    const voted      = Object.keys(room.confirmVotes).length;

    io.to(room.code).emit('confirm-update', { yes: yesCount, no: noCount, voted, total: aliveCount });

    if (voted >= aliveCount) {
      clearTimeout(room.confirmTimer);
      setTimeout(() => resolveConfirmation(room), 500);
    }
  });

  // ── Hunter ───────────────────────────────────────────────────────────────────

  socket.on('hunter-shot', ({ targetId }) => {
    const room = rooms[socket.roomCode];
    if (!room || room.phase !== 'hunter-shooting') return;
    const hunter = room.players.find(p => p.id === socket.id && p.role === 'hunter');
    if (!hunter || !room.huntersPending?.has(socket.id)) return;

    room.huntersPending.delete(socket.id);
    let shotPlayer = null;
    if (targetId) {
      const t = room.players.find(p => p.id === targetId && p.alive);
      if (t) { t.alive = false; shotPlayer = t; }
    }

    io.to(room.code).emit('hunter-shot-result', {
      hunterName: hunter.name,
      shotPlayer: shotPlayer ? { name: shotPlayer.name, role: shotPlayer.role } : null,
    });

    if (shotPlayer?.role === 'hunter') {
      room.huntersPending.add(shotPlayer.id);
      io.to(shotPlayer.id).emit('hunter-shoot', { players: aliveSummary(room).filter(p => p.id !== shotPlayer.id) });
      io.to(room.code).emit('hunter-shooting', { names: [shotPlayer.name] });
      return;
    }

    if (room.huntersPending.size === 0) {
      const onDone = room.hunterOnDone;
      delete room.hunterOnDone;
      delete room.huntersPending;
      if (onDone) onDone();
    }
  });

  // ── SPYFALL ──────────────────────────────────────────────────────────────────

  socket.on('spy:create', ({ name, gameSec }) => {
    const code = genSpyCode();
    const player = { id: socket.id, name: name.trim().slice(0, 15), isHost: true };
    const sec = Math.max(60, Math.min(600, parseInt(gameSec) || 300));
    spyRooms[code] = { code, players: [player], phase: 'lobby', gameSec: sec, location: null, spyId: null, votes: {}, gameTimer: null };
    socket.join('spy:' + code);
    socket.spyCode = code;
    socket.emit('spy:created', { code, playerId: socket.id, players: [player] });
  });

  socket.on('spy:join', ({ name, code }) => {
    const room = spyRooms[code?.toUpperCase()];
    if (!room)                   return socket.emit('spy:error', '❌ ไม่พบห้องนี้');
    if (room.phase !== 'lobby')  return socket.emit('spy:error', '❌ เกมเริ่มแล้ว');
    if (room.players.length >= 10) return socket.emit('spy:error', '❌ ห้องเต็ม (สูงสุด 10 คน)');
    const player = { id: socket.id, name: name.trim().slice(0, 15), isHost: false };
    room.players.push(player);
    socket.join('spy:' + code.toUpperCase());
    socket.spyCode = code.toUpperCase();
    socket.emit('spy:joined', { code: room.code, playerId: socket.id, players: room.players });
    io.to('spy:' + room.code).emit('spy:lobby-update', { players: room.players });
  });

  socket.on('spy:start', () => {
    const room = spyRooms[socket.spyCode];
    if (!room || room.phase !== 'lobby') return;
    if (!room.players.find(p => p.id === socket.id && p.isHost)) return;
    if (room.players.length < 3) return socket.emit('spy:error', '❌ ต้องการผู้เล่นอย่างน้อย 3 คน');
    const loc = SPY_LOCATIONS[Math.floor(Math.random() * SPY_LOCATIONS.length)];
    room.location = loc;
    const spyIdx = Math.floor(Math.random() * room.players.length);
    room.spyId = room.players[spyIdx].id;
    const roles = [...loc.roles].sort(() => Math.random() - 0.5);
    room.phase = 'game';
    room.votes = {};
    const locationNames = SPY_LOCATIONS.map(l => l.name);
    room.players.forEach((p, i) => {
      const sock = io.sockets.sockets.get(p.id);
      if (!sock) return;
      if (p.id === room.spyId) {
        sock.emit('spy:game-start', { isSpy: true, location: null, role: null, gameSec: room.gameSec, locations: locationNames });
      } else {
        sock.emit('spy:game-start', { isSpy: false, location: loc.name, role: roles[i % roles.length], gameSec: room.gameSec, locations: locationNames });
      }
    });
    io.to('spy:' + room.code).emit('spy:players', { players: room.players });
    room.gameTimer = setTimeout(() => { if (room.phase === 'game') startSpyVote(room); }, room.gameSec * 1000);
  });

  socket.on('spy:declare', ({ location }) => {
    const room = spyRooms[socket.spyCode];
    if (!room || room.phase !== 'game' || socket.id !== room.spyId) return;
    clearTimeout(room.gameTimer);
    const correct = room.location.name === location;
    room.phase = 'gameover';
    io.to('spy:' + room.code).emit('spy:gameover', {
      winner: correct ? 'spy' : 'village', spyId: room.spyId, location: room.location.name,
      reason: correct ? '🕵️ สายลับเดาสถานที่ถูกต้อง!' : '🎉 สายลับเดาสถานที่ผิด ชาวเมืองชนะ!',
      players: room.players,
    });
  });

  socket.on('spy:call-vote', () => {
    const room = spyRooms[socket.spyCode];
    if (!room || room.phase !== 'game') return;
    clearTimeout(room.gameTimer);
    startSpyVote(room);
  });

  socket.on('spy:vote', ({ targetId }) => {
    const room = spyRooms[socket.spyCode];
    if (!room || room.phase !== 'voting') return;
    if (room.votes[socket.id]) return;
    room.votes[socket.id] = targetId;
    io.to('spy:' + room.code).emit('spy:vote-update', { count: Object.keys(room.votes).length, total: room.players.length });
    if (Object.keys(room.votes).length >= room.players.length) resolveSpyVote(room);
  });

  socket.on('spy:location-guess', ({ location }) => {
    const room = spyRooms[socket.spyCode];
    if (!room || room.phase !== 'spy-guess' || socket.id !== room.spyId) return;
    const correct = room.location.name === location;
    room.phase = 'gameover';
    io.to('spy:' + room.code).emit('spy:gameover', {
      winner: correct ? 'spy' : 'village', spyId: room.spyId, location: room.location.name,
      reason: correct ? '🕵️ สายลับถูกจับแต่เดาสถานที่ถูก — สายลับชนะ!' : '🎉 ชาวเมืองชนะ! สายลับถูกจับและเดาสถานที่ผิด!',
      players: room.players,
    });
  });

  // ── Disconnect ───────────────────────────────────────────────────────────────

  socket.on('disconnect', () => {
    // Werewolf cleanup
    const room = rooms[socket.roomCode];
    if (room) {
      const wasHost = room.players.find(p => p.id === socket.id && p.isHost);
      room.players = room.players.filter(p => p.id !== socket.id);
      if (room.players.length === 0) { delete rooms[socket.roomCode]; }
      else if (room.phase === 'lobby') {
        if (wasHost) room.players[0].isHost = true;
        io.to(room.code).emit('lobby-update', { players: room.players });
      }
    }
    // Spyfall cleanup
    const spyRoom = spyRooms[socket.spyCode];
    if (spyRoom && spyRoom.phase === 'lobby') {
      const wasHost = spyRoom.players.find(p => p.id === socket.id && p.isHost);
      spyRoom.players = spyRoom.players.filter(p => p.id !== socket.id);
      if (spyRoom.players.length === 0) { delete spyRooms[socket.spyCode]; }
      else {
        if (wasHost) spyRoom.players[0].isHost = true;
        io.to('spy:' + spyRoom.code).emit('spy:lobby-update', { players: spyRoom.players });
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => console.log(`🐺 Werewolf server on http://localhost:${PORT}`));
