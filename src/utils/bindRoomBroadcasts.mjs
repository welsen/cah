import { getLobbyRooms } from './getLobbyRooms.mjs';

// helper to bind a room's events to socket broadcasts
export function bindRoomBroadcasts(appInstance, room, io) {
  if (!room || !room.id) return;
  room.on('playerJoined', (player) => {
    try {
      io.to(room.id).emit('playerJoined', { id: player.id, username: player.name, score: player.score || 0 });
      // broadcast updated room state (players with username + ready + score)
      const playersState = Array.from(room.players.values()).map((p) => ({
        id: p.id,
        username: p.name,
        isReady: !!p.isReady,
        score: p.score || 0,
      }));
      io.to(room.id).emit('roomState', {
        players: playersState,
        creatorId: room.creatorId,
        creatorName: room.creatorName,
      });
      const readyCount = playersState.filter((p) => p.isReady).length;
      io.to(room.id).emit('readyCount', { readyCount, totalPlayers: room.players.size });

      // also update lobby summaries so other clients see updated player counts
      try {
        io.emit('lobbyRooms', getLobbyRooms(appInstance));
      } catch (e) {
        console.error('Error broadcasting lobbyRooms on player join', e);
      }

      // submissions / judge events
      room.on('submissionCount', ({ count, required } = {}) => {
        try {
          io.to(room.id).emit('submissionCount', { count, required });
        } catch (e) {
          console.error('Error broadcasting submissionCount', e);
        }
      });

      room.on('submissionsReady', (payloadOrList) => {
        try {
          // payload may be: array (legacy) or object { submissions: [...], black: {...} }
          let submissions = [];
          let black = null;
          if (Array.isArray(payloadOrList)) {
            submissions = payloadOrList;
          } else if (payloadOrList && payloadOrList.submissions) {
            submissions = payloadOrList.submissions;
            black = payloadOrList.black || null;
          }

          // include judge id and optional black card in payload so clients can verify and show black text
          const payload = {
            judgeId: room.game && room.game.currentJudge && room.game.currentJudge.id,
            submissions,
            black,
          };
          const judgeId = payload.judgeId;
          const judgeSockets = judgeId ? appInstance.getSocketsForPlayer(judgeId) : [];
          if (judgeSockets && judgeSockets.length) {
            judgeSockets.forEach((s) => s.emit('submissionsReady', payload));
          } else {
            // fallback: broadcast to room (clients will ignore if they're not the judge)
            console.warn(`No socket registered for judge ${judgeId} when sending submissionsReady — broadcasting as fallback`);
            io.to(room.id).emit('submissionsReady', payload);
          }
        } catch (e) {
          console.error('Error broadcasting submissionsReady', e);
        }
      });

      room.on('roundWinner', (result) => {
        try {
          console.debug('[index] broadcasting roundWinner', { roomId: room.id, result });
          io.to(room.id).emit('roundWinner', result);
        } catch (e) {
          console.error('Error broadcasting roundWinner', e);
        }
      });

      room.on('gameEnded', (result) => {
        try {
          io.to(room.id).emit('gameEnded', result);
        } catch (e) {
          console.error('Error broadcasting gameEnded', e);
        }
      });

      room.on('judgeChanged', (judgeId) => {
        try {
          io.to(room.id).emit('judgeChanged', { judgeId });
        } catch (e) {
          console.error('Error broadcasting judgeChanged', e);
        }
      });
    } catch (e) {
      console.error('Error broadcasting playerJoined:', e);
    }
  });

  // broadcast game state changes
  room.on('gameStateChanged', (state) => {
    try {
      io.to(room.id).emit('gameState', { state });
    } catch (e) {
      console.error('Error broadcasting gameStateChanged:', e);
    }
  });

  // broadcast when a player submits (useful for clients to lock out further submissions)
  room.on('playerSubmitted', ({ playerId, affectedPlayerId, submissionId, auto } = {}) => {
    try {
      console.debug('[index] broadcasting playerSubmitted', { roomId: room.id, playerId, affectedPlayerId, submissionId, auto });
      // broadcast to the whole room (for submissionCount visibility)
      io.to(room.id).emit('playerSubmitted', { playerId, affectedPlayerId, submissionId, auto });

      // also ensure the affected player (if any) gets a direct notification and updated hand (helps when timing/mapping causes them to miss the room broadcast)
      if (affectedPlayerId) {
        const player = room.players.get(affectedPlayerId);
        const sockets = appInstance.getSocketsForPlayer(affectedPlayerId);
        if (sockets && sockets.length) {
          sockets.forEach((s) => {
            try {
              s.emit('playerSubmitted', { playerId: null, affectedPlayerId, submissionId, auto });
            } catch (e) {
              console.warn('Error emitting playerSubmitted to socket', s.id, e);
            }
            // send the player's current hand to their sockets to ensure UI reflects card removal
            try {
              if (player && player.hand) s.emit('playerHand', { hand: player.hand.slice() });
            } catch (e) {
              console.warn('Error emitting playerHand to socket', s.id, e);
            }
          });
        } else {
          console.warn(`No sockets found for affected player ${affectedPlayerId} when sending direct playerSubmitted`);
        }
      } else if (playerId) {
        // backward-compatible: individual player submit (non-system) — notify their sockets too
        const player = room.players.get(playerId);
        const sockets = appInstance.getSocketsForPlayer(playerId);
        if (sockets && sockets.length) {
          sockets.forEach((s) => {
            try {
              s.emit('playerSubmitted', { playerId, submissionId, auto });
            } catch (e) {
              console.warn('Error emitting playerSubmitted to socket', s.id, e);
            }
            try {
              if (player && player.hand) s.emit('playerHand', { hand: player.hand.slice() });
            } catch (e) {
              console.warn('Error emitting playerHand to socket', s.id, e);
            }
          });
        }
      }
    } catch (e) {
      console.error('Error broadcasting playerSubmitted', e);
    }
  });

  // broadcast hands and black card when dealt
  room.on('handsDealt', ({ hands }) => {
    try {
      console.debug('[index] broadcasting handsDealt', { roomId: room.id, playerCount: Object.keys(hands || {}).length });
      // send each player's hand to their socket(s) using appInstance mapping
      for (const [pid, hand] of Object.entries(hands || {})) {
        const sockets = appInstance.getSocketsForPlayer(pid);
        if (sockets && sockets.length) {
          sockets.forEach((s) => s.emit('playerHand', { hand }));
        } else {
          console.warn(`No socket found for player ${pid} when broadcasting hands`);
        }
      }
    } catch (e) {
      console.error('Error broadcasting handsDealt:', e);
    }
  });

  room.on('blackCard', (card) => {
    try {
      io.to(room.id).emit('blackCard', card);
    } catch (e) {
      console.error('Error broadcasting blackCard:', e);
    }
  });

  // when a player leaves, update lobby summaries
  room.on('playerLeft', () => {
    try {
      io.emit('lobbyRooms', getLobbyRooms(appInstance));
    } catch (e) {
      console.error('Error broadcasting lobbyRooms on playerLeft', e);
    }
  });

  // broadcast authoritative room state when Room emits 'roomState' (e.g., game end cleanup)
  room.on('roomState', (state) => {
    try {
      io.to(room.id).emit('roomState', state);
    } catch (e) {
      console.error('Error broadcasting roomState', e);
    }
  });
}
