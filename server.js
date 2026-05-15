const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const httpServer = http.createServer(app);
const io = new Server(httpServer);
app.use(express.static(path.join(__dirname)));

const rooms = {};

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

  io.to(room.code).emit('day-start', {
    day: room.day,
    eliminated: eliminated.map(p => ({ id: p.id, name: p.name, role: p.role })),
    players: aliveSummary(room),
    discussionSec: DISCUSS_SEC,
  });

  // Auto-open voting after discussion timer
  room.discussionTimer = setTimeout(() => {
    if (room.phase === 'day') openVoting(room);
  }, DISCUSS_SEC * 1000);
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

  socket.on('create-room', ({ name }) => {
    const code = genCode();
    const player = { id: socket.id, name: name.trim().slice(0, 15), role: null, alive: true, isHost: true };
    rooms[code] = {
      code, players: [player], phase: 'lobby', day: 0,
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

  // ── Disconnect ───────────────────────────────────────────────────────────────

  socket.on('disconnect', () => {
    const room = rooms[socket.roomCode];
    if (!room) return;
    const wasHost = room.players.find(p => p.id === socket.id && p.isHost);
    room.players = room.players.filter(p => p.id !== socket.id);
    if (room.players.length === 0) { delete rooms[socket.roomCode]; return; }
    if (room.phase === 'lobby') {
      if (wasHost) room.players[0].isHost = true;
      io.to(room.code).emit('lobby-update', { players: room.players });
    }
  });
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => console.log(`🐺 Werewolf server on http://localhost:${PORT}`));
