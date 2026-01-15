import Lobby from './utils/lobby.mjs';
import { GameState } from './utils/gameState.enum.mjs';

class App {
  static instance;

  lobby;

  constructor() {
    this.name = 'Cards Against Humanity Server';
    this.lobby = new Lobby();

    // map of playerId => Set of socket ids (supports multi-tab)
    this.playerSockets = new Map();
    // timers for disconnected players to allow brief refresh reconnects
    this.playerDisconnectTimers = new Map();
  }

  // register a socket as belonging to a player
  registerSocketForPlayer(playerId, socket) {
    if (!playerId || !socket) return;
    // clear any pending disconnect timer for this player
    const pending = this.playerDisconnectTimers.get(playerId);
    if (pending) {
      clearTimeout(pending);
      this.playerDisconnectTimers.delete(playerId);
    }

    let set = this.playerSockets.get(playerId);
    if (!set) {
      set = new Set();
      this.playerSockets.set(playerId, set);
    }
    set.add(socket.id);
    socket.data = socket.data || {};
    socket.data.playerId = playerId;
    console.debug('[app] registered socket', { playerId, socketId: socket.id });
  }

  // remove a socket from any player mapping
  unregisterSocket(socket) {
    if (!socket || !socket.data) return;
    const playerId = socket.data.playerId;
    if (!playerId) return;
    const set = this.playerSockets.get(playerId);
    if (!set) return;
    set.delete(socket.id);
    if (set.size === 0) this.playerSockets.delete(playerId);
    console.debug('[app] unregistered socket', { playerId, socketId: socket.id });
  }

  // get actual socket instances for a playerId
  getSocketsForPlayer(playerId) {
    const set = this.playerSockets.get(playerId);
    if (!set || !this.io || !this.io.sockets) return [];
    const out = [];
    for (const sid of set) {
      const s = this.io.sockets.sockets.get(sid);
      if (s) out.push(s);
    }
    return out;
  }

  static getInstance() {
    if (!App.instance) {
      App.instance = new App();
    }
    return App.instance;
  }

  handleConnection(socket) {
    // when a client registers (page join), put their socket into the room and store metadata
    socket.on('register', ({ roomId, playerId } = {}) => {
      try {
        if (!roomId || !playerId) return;
        const room = this.lobby.getRoom(roomId);
        if (!room) return;
        socket.join(roomId);
        socket.data.playerId = playerId;
        socket.data.roomId = roomId;
        // track this socket in the player->socket map
        this.registerSocketForPlayer(playerId, socket);
        console.log(`Socket ${socket.id} registered for room ${roomId} as player ${playerId}`);

        // Send current ready state for all players in room to this socket
        const playersState = Array.from(room.players.values()).map((p) => ({
          id: p.id,
          username: p.name,
          isReady: !!p.isReady,
          score: p.score || 0,
        }));
        socket.emit('roomState', {
          players: playersState,
          creatorId: room.creatorId,
          creatorName: room.creatorName,
          judgeId: room.game && room.game.currentJudge && room.game.currentJudge.id,
        });
        // also send a readyCount summary
        const readyCount = playersState.filter((p) => p.isReady).length;
        const totalPlayers = room.players.size;
        socket.emit('readyCount', { readyCount, totalPlayers });

        // If a game is already in progress, send the private hand and current black card to the registering socket
        try {
          if (room.game && room.game.gameState && room.game.gameState !== undefined) {
            // send game state to the single socket
            socket.emit('gameState', { state: room.game.gameState });
            const player = room.players.get(playerId);
            if (player && player.hand && player.hand.length) {
              socket.emit('playerHand', { hand: player.hand.slice() });
              console.debug('[app] sent playerHand on register', { roomId, playerId, socketId: socket.id });
            } else {
              console.debug('[app] no hand to send on register', { roomId, playerId });
            }
            if (room.game.currentBlackCard) {
              socket.emit('blackCard', room.game.currentBlackCard);
            }

            // send full hands mapping to the registering socket for robust rehydration
            try {
              const handsMap = {};
              for (const p of room.players.values()) {
                handsMap[p.id] = (p.hand && p.hand.slice()) || [];
              }
              socket.emit('handsDealt', { hands: handsMap });
            } catch (hErr) {
              console.warn('Error sending handsMap to registering socket', hErr);
            }
            // only send submission count when meaningful (avoid showing empty placeholders before game start)
            if (
              room.game.submissions &&
              (room.game.submissions.size > 0 ||
                room.game.gameState === GameState.SELECTING_CARDS ||
                room.game.gameState === GameState.JUDGING_CARDS)
            ) {
              const required = room.players.size === 2 ? 2 : Math.max(0, room.players.size - 1);
              socket.emit('submissionCount', { count: room.game.submissions.size, required });
              // send per-submission markers to the registering socket so UI shows which players submitted
              for (const s of room.game.submissions.values()) {
                try {
                  // for explicit player submissions, notify register socket so UI can show participant as submitted
                  if (s.playerId) {
                    socket.emit('playerSubmitted', { playerId: s.playerId, submissionId: s.id, auto: !!s.auto });
                  }
                } catch (inner) {
                  console.warn('Error emitting playerSubmitted to registering socket', inner);
                }
              }

              // if this registering socket is the judge and all submissions are in, send submissionsReady with black card
              const judgeId = room.game && room.game.currentJudge && room.game.currentJudge.id;
              const requiredCount = (room.players.size === 2) ? 2 : Math.max(0, room.players.size - 1);
              if (String(judgeId) === String(playerId) && room.game.submissions.size >= requiredCount) {
                // prepare anonymized list
                const list = Array.from(room.game.submissions.values()).map(s => ({ id: s.id, text: Array.isArray(s.card) ? s.card.map(c=>c.text||'').join(' / ') : (s.card && (s.card.text || '')) }));
                socket.emit('submissionsReady', { judgeId, submissions: list, black: room.game.currentBlackCard });
              }            }
          }
        } catch (e) {
          console.error('Error sending post-register game state:', e);
        }
      } catch (err) {
        console.error('Error registering socket:', err);
      }
    });

    // handle ready state changes coming from clients
    socket.on('playerReady', ({ roomId, playerId, ready } = {}, ack) => {
      try {
        if (!roomId || !playerId) {
          if (typeof ack === 'function') ack({ ok: false, error: 'missing_params' });
          return;
        }
        const room = this.lobby.getRoom(roomId);
        if (!room) {
          if (typeof ack === 'function') ack({ ok: false, error: 'room_not_found' });
          return;
        }
        const player = room.players.get(playerId);
        if (!player) {
          if (typeof ack === 'function') ack({ ok: false, error: 'player_not_in_room' });
          return;
        }

        // set the player's ready state
        player.isReady = !!ready;
        // notify everyone in the room (including sender)
        socket.to(roomId).emit('playerReady', { playerId, ready: !!ready });
        socket.emit('playerReady', { playerId, ready: !!ready });

        // compute and broadcast ready counts
        const playersStateNow = Array.from(room.players.values()).map((p) => ({ id: p.id, isReady: !!p.isReady }));
        const readyCountNow = playersStateNow.filter((p) => p.isReady).length;
        const totalPlayersNow = room.players.size;
        socket.to(roomId).emit('readyCount', { readyCount: readyCountNow, totalPlayers: totalPlayersNow });
        socket.emit('readyCount', { readyCount: readyCountNow, totalPlayers: totalPlayersNow });

        // if all players are ready, optionally notify (useful to auto-start)
        if (totalPlayersNow > 0 && readyCountNow === totalPlayersNow) {
          socket.to(roomId).emit('allReady');
          socket.emit('allReady');

          // notify the creator specifically so they can initiate game start
          try {
            const creatorId = room.creatorId;
            if (creatorId && this.io && this.io.sockets) {
              for (const [sid, sSocket] of this.io.sockets.sockets) {
                if (sSocket.data && sSocket.data.playerId === creatorId) {
                  sSocket.emit('creatorAllReady', { roomId, creatorId });
                }
              }
            }
          } catch (e) {
            console.error('Error notifying creator of allReady', e);
          }
        }

        if (typeof ack === 'function') ack({ ok: true, ready: !!ready });
        console.log(`Player ${playerId} in room ${roomId} set ready=${!!ready}`);
      } catch (err) {
        console.error('Error handling playerReady:', err);
        if (typeof ack === 'function') ack({ ok: false, error: 'exception' });
      }
    });

    // handle creator-initiated startGame
    socket.on('startGame', ({ roomId, playerId } = {}, ack) => {
      try {
        if (!roomId || !playerId) {
          if (typeof ack === 'function') ack({ ok: false, error: 'missing_params' });
          return;
        }
        const room = this.lobby.getRoom(roomId);
        if (!room) {
          if (typeof ack === 'function') ack({ ok: false, error: 'room_not_found' });
          return;
        }
        // only allow creator to start the game
        if (!room.creatorId || room.creatorId !== playerId) {
          if (typeof ack === 'function') ack({ ok: false, error: 'not_creator' });
          return;
        }

        // ensure all players are ready before starting
        const playersStateNow = Array.from(room.players.values()).map((p) => ({ id: p.id, isReady: !!p.isReady }));
        const readyCountNow = playersStateNow.filter((p) => p.isReady).length;
        const totalPlayersNow = room.players.size;
        if (totalPlayersNow === 0 || readyCountNow !== totalPlayersNow) {
          if (typeof ack === 'function') ack({ ok: false, error: 'not_all_ready' });
          return;
        }

        room.startGame();
        // broadcast the new game state
        const state = room.gameState;
        socket.to(roomId).emit('gameStarted', { roomId, startedBy: playerId, state });
        socket.emit('gameStarted', { roomId, startedBy: playerId, state });

        if (typeof ack === 'function') ack({ ok: true });
      } catch (err) {
        console.error('Error handling startGame:', err);
        if (typeof ack === 'function') ack({ ok: false, error: 'exception' });
      }
    });

    // handle a player playing a card into the submissions pool
    socket.on('playCard', ({ roomId, playerId, cardId } = {}, ack) => {
      try {
        if (!roomId || !playerId || !cardId) {
          if (typeof ack === 'function') ack({ ok: false, error: 'missing_params' });
          return;
        }
        const room = this.lobby.getRoom(roomId);
        if (!room) {
          if (typeof ack === 'function') ack({ ok: false, error: 'room_not_found' });
          return;
        }
        // ensure player is in the room
        const player = room.players.get(playerId);
        if (!player) {
          if (typeof ack === 'function') ack({ ok: false, error: 'player_not_in_room' });
          return;
        }
        // forward to game (expected errors are handled gracefully)
        try {
          console.debug('[app] playCard request', { roomId, playerId, cardId });
          const res = room.playCard(playerId, cardId);
          console.debug('[app] playCard result', res);
          if (typeof ack === 'function') ack(res);
        } catch (innerErr) {
          // list of expected validation errors coming from Game.playCard
          const expected = [
            'already_submitted',
            'judge_cannot_play',
            'card_not_in_hand',
            'Game not in progress',
            'player_not_in_room',
            'already_submitted',
          ];
          const msg = innerErr && innerErr.message ? innerErr.message : String(innerErr);
          if (expected.includes(msg)) {
            console.debug('playCard rejected (expected):', msg);
            if (typeof ack === 'function') ack({ ok: false, error: msg });
          } else {
            console.error('Error handling playCard:', innerErr);
            if (typeof ack === 'function')
              ack({ ok: false, error: innerErr && innerErr.message ? innerErr.message : 'exception' });
          }
        }
      } catch (err) {
        console.error('Error handling playCard (outer):', err);
        if (typeof ack === 'function') ack({ ok: false, error: err && err.message ? err.message : 'exception' });
      }
    });

    // handle judge picking a winning submission
    socket.on('judgePick', ({ roomId, playerId, submissionId } = {}, ack) => {
      try {
        if (!roomId || !playerId || !submissionId) {
          if (typeof ack === 'function') ack({ ok: false, error: 'missing_params' });
          return;
        }
        const room = this.lobby.getRoom(roomId);
        if (!room) {
          if (typeof ack === 'function') ack({ ok: false, error: 'room_not_found' });
          return;
        }
        // call into room to perform judge pick (handle expected errors cleanly)
        try {
          const res = room.judgePick(playerId, submissionId);
          if (typeof ack === 'function') ack(res);
        } catch (innerErr) {
          const expected = ['not_authorized', 'submission_not_found', 'Game not in progress'];
          const msg = innerErr && innerErr.message ? innerErr.message : String(innerErr);
          if (expected.includes(msg)) {
            console.debug('judgePick rejected (expected):', msg);
            if (typeof ack === 'function') ack({ ok: false, error: msg });
          } else {
            console.error('Error handling judgePick:', innerErr);
            if (typeof ack === 'function')
              ack({ ok: false, error: innerErr && innerErr.message ? innerErr.message : 'exception' });
          }
        }
      } catch (err) {
        console.error('Error handling judgePick (outer):', err);
        if (typeof ack === 'function') ack({ ok: false, error: err && err.message ? err.message : 'exception' });
      }
    });

    // allow a client to leave the room proactively
    socket.on('leaveRoom', ({ roomId, playerId } = {}, ack) => {
      try {
        if (!roomId || !playerId) {
          if (typeof ack === 'function') ack({ ok: false, error: 'missing_params' });
          return;
        }
        const room = this.lobby.getRoom(roomId);
        if (!room) {
          if (typeof ack === 'function') ack({ ok: false, error: 'room_not_found' });
          return;
        }

        if (!room.hasPlayer(playerId)) {
          if (typeof ack === 'function') ack({ ok: false, error: 'player_not_in_room' });
          return;
        }

        try {
          // if the leaving player is the creator, disband the room entirely
          const isCreator = room.creatorId && String(room.creatorId) === String(playerId);
          if (isCreator) {
            try {
              // notify remaining clients in the room that it is being disbanded
              this.io && this.io.to && this.io.to(roomId).emit && this.io.to(roomId).emit('roomDisbanded', { roomId, reason: 'creator_left' });

              // make all sockets in the room leave and notify them as needed
              for (const p of Array.from(room.players.values())) {
                const sockets = this.getSocketsForPlayer(p.id) || [];
                sockets.forEach((s) => {
                  try {
                    s.leave(roomId);
                    if (s.data) delete s.data.roomId;
                  } catch (e) {
                    console.warn('Error removing socket from room during disband', e);
                  }
                });
              }

              // remove the room from the lobby (this triggers lobby 'roomRemoved' listeners)
              this.lobby.removeRoom(roomId);
            } catch (e) {
              console.error('Error disbanding room on creator leave', e);
            }

            if (typeof ack === 'function') ack({ ok: true, disbanded: true });
            return;
          }

          // remove the player from the room
          room.removePlayer(playerId);

          // broadcast to the room that a player has left and emit updated room state
          try {
            // notify room clients the player left
            this.io && this.io.to && this.io.to(roomId).emit && this.io.to(roomId).emit('playerLeft', { playerId });

            // send authoritative roomState to remaining players
            const playersState = Array.from(room.players.values()).map((p) => ({ id: p.id, username: p.name, isReady: !!p.isReady, score: p.score || 0 }));
            this.io && this.io.to && this.io.to(roomId).emit && this.io.to(roomId).emit('roomState', { players: playersState, creatorId: room.creatorId, creatorName: room.creatorName, judgeId: room.game && room.game.currentJudge && room.game.currentJudge.id });
            // update ready counts
            const readyCountNow = playersState.filter((p) => p.isReady).length;
            this.io && this.io.to && this.io.to(roomId).emit && this.io.to(roomId).emit('readyCount', { readyCount: readyCountNow, totalPlayers: room.players.size });
          } catch (e) {
            console.error('Error emitting room-level leave notifications', e);
          }

          // ensure any sockets associated with that player leave the socket.io room
          const sockets = this.getSocketsForPlayer(playerId) || [];
          sockets.forEach((s) => {
            try {
              s.leave(roomId);
              if (s.data) delete s.data.roomId;
            } catch (e) {
              console.warn('Error removing socket from room during leaveRoom', e);
            }
          });

          // broadcast updated lobby rooms
          try {
            this.io && this.io.emit && this.io.emit('lobbyRooms', Array.from(this.lobby.rooms.values()).map((r) => ({ id: r.id, name: r.name, playerCount: r.players.size, maxPlayers: r.maxPlayers })));
          } catch (e) {
            console.error('Error emitting lobbyRooms after leaveRoom', e);
          }

          if (typeof ack === 'function') ack({ ok: true });
        } catch (e) {
          console.error('Error handling leaveRoom inner:', e);
          if (typeof ack === 'function') ack({ ok: false, error: 'exception' });
        }
      } catch (err) {
        console.error('Error handling leaveRoom:', err);
        if (typeof ack === 'function') ack({ ok: false, error: err && err.message ? err.message : 'exception' });
      }
    });

    // client can request their private hand if they think they missed it
    socket.on('requestHand', ({ roomId, playerId } = {}, ack) => {
      try {
        if (!roomId || !playerId) {
          if (typeof ack === 'function') ack({ ok: false, error: 'missing_params' });
          return;
        }
        const room = this.lobby.getRoom(roomId);
        if (!room) {
          if (typeof ack === 'function') ack({ ok: false, error: 'room_not_found' });
          return;
        }
        const player = room.players.get(playerId);
        if (!player) {
          if (typeof ack === 'function') ack({ ok: false, error: 'player_not_in_room' });
          return;
        }
        // send hand to this socket directly
        socket.emit('playerHand', { hand: player.hand ? player.hand.slice() : [] });
        if (room.game && room.game.currentBlackCard) socket.emit('blackCard', room.game.currentBlackCard);
        if (typeof ack === 'function') ack({ ok: true });
        console.debug('[app] requestHand fulfilled', { roomId, playerId, socketId: socket.id });
      } catch (e) {
        console.error('Error handling requestHand:', e);
        if (typeof ack === 'function') ack({ ok: false, error: 'exception' });
      }
    });

    socket.on('disconnect', (reason) => {
      console.log(`Client disconnected: ${socket.id}`, reason);

      // unregister socket from player mapping so we don't keep stale ids
      try {
        const playerId = socket.data && socket.data.playerId;
        this.unregisterSocket(socket);

        // If this player has no other sockets, schedule a delayed removal (grace period for refresh)
        if (playerId) {
          const sockets = this.getSocketsForPlayer(playerId);
          if (!sockets || sockets.length === 0) {
            // schedule removal after 10s
            const tid = setTimeout(() => {
              for (const room of this.lobby.rooms.values()) {
                if (room.hasPlayer(playerId)) {
                  try {
                    console.log(`Removing player ${playerId} from room ${room.id} after disconnect grace`);
                    // if the leaving player was the creator, disband the room
                    if (room.creatorId && String(room.creatorId) === String(playerId)) {
                      try {
                        this.io && this.io.to && this.io.to(room.id).emit && this.io.to(room.id).emit('roomDisbanded', { roomId: room.id, reason: 'creator_left' });
                        // remove room from lobby (triggers lobby roomRemoved listeners)
                        this.lobby.removeRoom(room.id);
                      } catch (disErr) {
                        console.error('Error disbanding room after creator disconnect', disErr);
                      }
                    } else {
                      room.removePlayer(playerId);
                    }
                  } catch (e) {
                    console.error('Error removing player after grace', e);
                  }
                  break;
                }
              }
              // broadcast updated lobby rooms
              try {
                this.io &&
                  this.io.emit &&
                  this.io.emit(
                    'lobbyRooms',
                    Array.from(this.lobby.rooms.values()).map((r) => ({
                      id: r.id,
                      name: r.name,
                      playerCount: r.players.size,
                      maxPlayers: r.maxPlayers,
                    }))
                  );
              } catch (e) {
                console.error('Error emitting lobbyRooms after player removal', e);
              }
              this.playerDisconnectTimers.delete(playerId);
            }, 10000);
            this.playerDisconnectTimers.set(playerId, tid);
            console.log('[app] scheduled player removal after grace period', { playerId, timerId: tid });
          }
        }
      } catch (e) {
        console.error('Error unregistering socket', e);
      }
    });
  }
}

export default App;
