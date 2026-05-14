const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const httpServer = http.createServer(app);
const io = new Server(httpServer);

app.use(express.static(path.join(__dirname)));

const rooms = {};

function genCode() {
  let code;
  do { code = Math.random().toString(36).slice(2, 6).toUpperCase(); } while (rooms[code]);
  return code;
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function buildRoles(n) {
  const roles = [];
  const wolves = n <= 6 ? 1 : n <= 9 ? 2 : 3;
  for (let i = 0; i < wolves; i++) roles.push('werewolf');
  roles.push('seer');
  if (n >= 6) roles.push('doctor');
  while (roles.length < n) roles.push('villager');
  return shuffle(roles);
}

function checkWin(room) {
  const alive = room.players.filter(p => p.alive);
  const wolves = alive.filter(p => p.role === 'werewolf').length;
  const good = alive.length - wolves;
  if (wolves === 0) return 'villager';
  if (wolves >= good) return 'werewolf';
  return null;
}

function aliveSummary(room) {
  return room.players.filter(p => p.alive).map(p => ({ id: p.id, name: p.name }));
}

function startNight(room) {
  room.phase = 'night';
  room.nightActions = {};
  room.wolfVotes = {};

  const pending = new Set();
  if (room.players.some(p => p.role === 'werewolf' && p.alive)) pending.add('werewolf');
  if (room.players.some(p => p.role === 'seer' && p.alive)) pending.add('seer');
  if (room.players.some(p => p.role === 'doctor' && p.alive)) pending.add('doctor');
  room.nightPending = pending;

  io.to(room.code).emit('night-start', { day: room.day, players: aliveSummary(room) });

  if (pending.size === 0) setTimeout(() => resolveNight(room), 2000);
}

function resolveNight(room) {
  if (room.phase !== 'night') return;

  const tally = {};
  Object.values(room.wolfVotes).forEach(id => { tally[id] = (tally[id] || 0) + 1; });

  let wolfTarget = null, maxV = 0;
  Object.entries(tally).forEach(([id, cnt]) => { if (cnt > maxV) { maxV = cnt; wolfTarget = id; } });

  const doctorSave = room.nightActions.doctor;
  let eliminated = null;

  if (wolfTarget && wolfTarget !== doctorSave) {
    const p = room.players.find(p => p.id === wolfTarget && p.alive);
    if (p) { p.alive = false; eliminated = p; }
  }

  room.phase = 'day';

  const winner = checkWin(room);
  if (winner) { endGame(room, winner); return; }

  io.to(room.code).emit('day-start', {
    day: room.day,
    eliminated: eliminated ? { id: eliminated.id, name: eliminated.name, role: eliminated.role } : null,
    players: aliveSummary(room),
  });
}

function resolveVote(room) {
  if (room.phase !== 'voting') return;

  const tally = {};
  Object.values(room.votes).forEach(id => { tally[id] = (tally[id] || 0) + 1; });

  const maxV = Object.values(tally).reduce((a, b) => Math.max(a, b), 0);
  const tied = Object.entries(tally).filter(([, c]) => c === maxV);

  let eliminated = null;
  if (tied.length === 1) {
    const p = room.players.find(p => p.id === tied[0][0]);
    if (p) { p.alive = false; eliminated = p; }
  }

  io.to(room.code).emit('vote-result', {
    eliminated: eliminated ? { id: eliminated.id, name: eliminated.name, role: eliminated.role } : null,
    tied: tied.length > 1,
  });

  const winner = checkWin(room);
  if (winner) {
    setTimeout(() => endGame(room, winner), 4000);
  } else {
    room.day++;
    setTimeout(() => startNight(room), 4000);
  }
}

function endGame(room, winner) {
  room.phase = 'ended';
  io.to(room.code).emit('game-over', {
    winner,
    players: room.players.map(p => ({ id: p.id, name: p.name, role: p.role, alive: p.alive })),
  });
}

io.on('connection', socket => {

  socket.on('create-room', ({ name }) => {
    const code = genCode();
    const player = { id: socket.id, name: name.trim().slice(0, 15), role: null, alive: true, isHost: true };
    rooms[code] = { code, players: [player], phase: 'lobby', day: 0, nightActions: {}, wolfVotes: {}, nightPending: new Set(), votes: {} };
    socket.join(code);
    socket.roomCode = code;
    socket.emit('room-created', { code, players: rooms[code].players, playerId: socket.id });
  });

  socket.on('join-room', ({ code, name }) => {
    const room = rooms[code?.toUpperCase()];
    if (!room) return socket.emit('join-error', '❌ ไม่พบห้องนี้');
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
    const host = room.players.find(p => p.id === socket.id);
    if (!host?.isHost) return;
    if (room.players.length < 4) return socket.emit('join-error', '❌ ต้องมีผู้เล่นอย่างน้อย 4 คน');

    const roles = buildRoles(room.players.length);
    room.players.forEach((p, i) => { p.role = roles[i]; p.alive = true; });
    room.day = 1;

    room.players.forEach(p => {
      const teammates = p.role === 'werewolf'
        ? room.players.filter(pp => pp.role === 'werewolf' && pp.id !== p.id).map(pp => ({ id: pp.id, name: pp.name }))
        : [];
      io.to(p.id).emit('game-started', {
        role: p.role,
        teammates,
        players: room.players.map(pp => ({ id: pp.id, name: pp.name })),
      });
    });

    setTimeout(() => startNight(room), 8000);
  });

  socket.on('night-action', ({ targetId }) => {
    const room = rooms[socket.roomCode];
    if (!room || room.phase !== 'night') return;

    const player = room.players.find(p => p.id === socket.id);
    if (!player?.alive) return;

    const aliveWolves = room.players.filter(p => p.role === 'werewolf' && p.alive);

    if (player.role === 'werewolf') {
      if (room.wolfVotes[socket.id]) return;
      room.wolfVotes[socket.id] = targetId;

      const targetName = room.players.find(p => p.id === targetId)?.name;
      aliveWolves.filter(w => w.id !== socket.id).forEach(w => {
        io.to(w.id).emit('wolf-vote-update', { voterName: player.name, targetName });
      });

      if (Object.keys(room.wolfVotes).length >= aliveWolves.length) {
        room.nightPending.delete('werewolf');
      }
    } else if (player.role === 'seer') {
      if (!room.nightPending.has('seer')) return;
      const target = room.players.find(p => p.id === targetId);
      if (target) socket.emit('seer-result', { targetName: target.name, isWerewolf: target.role === 'werewolf' });
      room.nightPending.delete('seer');
    } else if (player.role === 'doctor') {
      if (!room.nightPending.has('doctor')) return;
      room.nightActions.doctor = targetId;
      room.nightPending.delete('doctor');
    }

    if (room.nightPending.size === 0) {
      setTimeout(() => resolveNight(room), 1000);
    }
  });

  socket.on('vote', ({ targetId }) => {
    const room = rooms[socket.roomCode];
    if (!room || room.phase !== 'day') return;

    const player = room.players.find(p => p.id === socket.id);
    if (!player?.alive || room.votes[socket.id]) return;

    room.votes[socket.id] = targetId;
    const aliveCount = room.players.filter(p => p.alive).length;

    io.to(room.code).emit('vote-update', {
      votes: room.votes,
      voteCount: Object.keys(room.votes).length,
      aliveCount,
    });

    if (Object.keys(room.votes).length >= aliveCount) {
      room.phase = 'voting';
      setTimeout(() => resolveVote(room), 1000);
    }
  });

  socket.on('disconnect', () => {
    const code = socket.roomCode;
    const room = rooms[code];
    if (!room) return;

    const wasPlayer = room.players.find(p => p.id === socket.id);
    room.players = room.players.filter(p => p.id !== socket.id);

    if (room.players.length === 0) { delete rooms[code]; return; }

    if (room.phase === 'lobby') {
      if (wasPlayer?.isHost && room.players.length > 0) room.players[0].isHost = true;
      io.to(code).emit('lobby-update', { players: room.players });
    }
  });
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => console.log(`🐺 Werewolf server on http://localhost:${PORT}`));
