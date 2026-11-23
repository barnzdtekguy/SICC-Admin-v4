'use strict';
const { HttpError } = require('../http');
const clients = new Map();

function watchTeam(teamId, profileId, res) {
  if (res.destroyed) return;
  const team = clients.get(teamId) || new Set();
  if ([...team].filter(client => client.profileId === profileId).length >= 4) throw new HttpError(429, 'Too many open team views.');
  clients.set(teamId, team);
  res.set({ 'Content-Type': 'text/event-stream', 'X-Accel-Buffering': 'no' });
  res.flushHeaders();
  res.write(': connected\n\n');
  const client = { profileId, res };
  team.add(client);
  const heartbeat = setInterval(() => res.write(': keep-alive\n\n'), 24000);
  const timeout = setTimeout(() => res.end(), 120000);
  res.on('close', () => {
    clearInterval(heartbeat);
    clearTimeout(timeout);
    team.delete(client);
    if (!team.size) clients.delete(teamId);
  });
}

function signalTeam(teamId) {
  for (const { res } of clients.get(teamId) || []) {
    if (!res.destroyed && !res.writableEnded && !res.writableNeedDrain) res.write('event: refresh\ndata: {}\n\n');
  }
}

module.exports = { watchTeam, signalTeam };
