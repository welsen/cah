import express from 'express';
import App from '../app.mjs';
import Room from '../utils/room.mjs';
import Player from '../utils/player.mjs';

const app = App.getInstance();

const ApiController = express.Router({ mergeParams: true });

ApiController.get('/status', (req, res) => {
  res.json({ status: 'ok' });
});

ApiController.get('/rooms', (req, res) => {
  const rooms = Array.from(app.lobby.rooms.values()).map((room) => ({
    id: room.id,
    name: room.name,
    playerCount: room.players.size,
    maxPlayers: room.maxPlayers,
    gameState: room.gameState,
  }));
  res.json({ rooms });
});

ApiController.get('/rooms/:id', (req, res) => {
  const room = app.lobby.getRoom(req.params.id);
  if (!room) {
    return res.status(404).json({ error: 'Room not found' });
  }
  res.json({
    id: room.id,
    name: room.name,
    playerCount: room.players.size,
    maxPlayers: room.maxPlayers,
    gameState: room.gameState,
    creatorId: room.creatorId,
    creatorName: room.creatorName,
    players: Array.from(room.players.values()).map((player) => {
      console.log('Player in room:', player);
      return { id: player.id, username: player.name };
    }),
  });
});

ApiController.post('/rooms', (req, res) => {
  const { name, maxPlayers, password } = req.body;
  try {
    // prevent duplicate room creation by name (case-insensitive)
    const roomName = (name || '').toString().trim().toLowerCase();
    if (roomName) {
      const existing = Array.from(app.lobby.rooms.values()).find((r) => (r.name || '').toLowerCase() === roomName);
      if (existing) {
        return res.status(200).json({ roomId: existing.id, message: 'Room already exists' });
      }
    }

    const room = new Room(name, maxPlayers, password);
    // attach creator name if provided
    if (req.body && req.body.creatorName) {
      room.creatorName = req.body.creatorName.toString().trim();
    }
    app.lobby.addRoom(room);
    console.debug('API: created room', { id: room.id, name: room.name });

    // Auto-join the creator (backwards-compatible convenience): if a creatorName is provided,
    // add them to the room immediately and return their playerId in the response.
    if (req.body && req.body.creatorName) {
      try {
        const player = addPlayerToRoom(room, req.body.creatorName, password);
        // ensure creatorId is set to the newly added player
        room.creatorId = player.id;
        console.debug('API: auto-joined creator', { roomId: room.id, playerId: player.id });
        return res.status(201).json({ roomId: room.id, playerId: player.id });
      } catch (e) {
        console.warn('Auto-join creator failed', e);
        // fall through and return roomId only
      }
    }

    res.status(201).json({ roomId: room.id });
  } catch (error) {
    // if addRoom throws due to race and room already exists, return existing id
    if (error && /already exists/i.test(error.message)) {
      const existing = Array.from(app.lobby.rooms.values()).find(
        (r) => (r.name || '').toLowerCase() === (name || '').toString().trim().toLowerCase()
      );
      if (existing) return res.status(200).json({ roomId: existing.id, message: 'Room already exists' });
    }
    res.status(400).json({ error: error.message });
  }
});

const addPlayerToRoom = (room, username, password) => {
  const player = new Player(username);
  room.addPlayer(player, password);
  console.log(`Server: added player ${player.name} (${player.id}) to room ${room.id}`);
  return player;
};

ApiController.post('/rooms/:id/join', (req, res) => {
  const room = app.lobby.getRoom(req.params.id);
  if (!room) {
    return res.status(404).json({ error: 'Room not found' });
  }
  const { username, password, playerId } = req.body;
  console.log(`API: Player ${username} is attempting to join room ${room.id}`);
  try {
    if (!playerId) {
      // prevent duplicate joins by username (case-insensitive)
      const name = (username || '').toString().trim().toLowerCase();
      if (name) {
        const existing = Array.from(room.players.values()).find((p) => (p.name || '').toLowerCase() === name);
        if (existing) {
          // set creatorId if appropriate
          if (!room.creatorId && room.creatorName && room.creatorName.toLowerCase() === name) {
            room.creatorId = existing.id;
          }
          return res.status(200).json({ message: 'Already in room', playerId: existing.id });
        }
        const existingSpec = Array.from(room.spectators.values()).find((p) => (p.name || '').toLowerCase() === name);
        if (existingSpec) {
          if (!room.creatorId && room.creatorName && room.creatorName.toLowerCase() === name) {
            room.creatorId = existingSpec.id;
          }
          return res.status(200).json({ message: 'Already in room (spectator)', playerId: existingSpec.id });
        }
      }
      const player = addPlayerToRoom(room, username, password);
      // if creator not set, assign if matches creatorName or if first player
      const lname = (username || '').toString().trim().toLowerCase();
      if (!room.creatorId) {
        if (room.creatorName && room.creatorName.toLowerCase() === lname) {
          room.creatorId = player.id;
        } else if (room.players.size === 1) {
          room.creatorId = player.id;
        }
      }
      return res.status(200).json({ message: 'Joined room successfully', playerId: player.id });
    } else {
      // playerId provided: treat as rejoin
      if (room.hasPlayer(playerId)) {
        return res.status(200).json({ message: 'Rejoined room successfully', playerId: playerId });
      }
      // playerId not found - try to match by username to avoid duplicates
      const name = (username || '').toString().trim().toLowerCase();
      if (name) {
        const existing = Array.from(room.players.values()).find((p) => (p.name || '').toLowerCase() === name);
        if (existing) {
          if (!room.creatorId && room.creatorName && room.creatorName.toLowerCase() === name) {
            room.creatorId = existing.id;
          }
          return res.status(200).json({ message: 'Already in room', playerId: existing.id });
        }
        const existingSpec = Array.from(room.spectators.values()).find((p) => (p.name || '').toLowerCase() === name);
        if (existingSpec) {
          if (!room.creatorId && room.creatorName && room.creatorName.toLowerCase() === name) {
            room.creatorId = existingSpec.id;
          }
          return res.status(200).json({ message: 'Already in room (spectator)', playerId: existingSpec.id });
        }
      }
      // if no existing player found, create a new one
      const player = addPlayerToRoom(room, username, password);
      // set creator as above
      const lname = (username || '').toString().trim().toLowerCase();
      if (!room.creatorId) {
        if (room.creatorName && room.creatorName.toLowerCase() === lname) {
          room.creatorId = player.id;
        } else if (room.players.size === 1) {
          room.creatorId = player.id;
        }
      }
      return res.status(200).json({ message: 'Rejoined room successfully', playerId: player.id });
    }
  } catch (error) {
    console.error('Join error:', error && error.message);
    // If addPlayer threw due to existing player, return the existing id instead of error
    if (error && /player already in room/i.test(error.message)) {
      const name = (username || '').toString().trim().toLowerCase();
      if (name) {
        const existing = Array.from(room.players.values()).find((p) => (p.name || '').toLowerCase() === name);
        if (existing) return res.status(200).json({ message: 'Already in room', playerId: existing.id });
        const existingSpec = Array.from(room.spectators.values()).find((p) => (p.name || '').toLowerCase() === name);
        if (existingSpec)
          return res.status(200).json({ message: 'Already in room (spectator)', playerId: existingSpec.id });
      }
    }
    res.status(400).json({ error: error.message });
  }
});

export default ApiController;
