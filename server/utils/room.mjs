import { EventEmitter } from 'events';
import Game from './game.mjs';
import { GameState } from './gameState.enum.mjs';
import { generateHashedRoomId } from './generateHashedRoomId.mjs';

class Room extends EventEmitter {
  name;
  #password;
  #game;

  constructor(name, maxPlayers = 10, password) {
    super();
    this.id = generateHashedRoomId();
    this.name = name;
    this.maxPlayers = maxPlayers;
    this.players = new Map();
    this.spectators = new Map();
    this.#password = password;
    this.#game = new Game(this);
    // creator metadata
    this.creatorId = null;
    this.creatorName = null;

    // forward game state changes so external systems (server) can broadcast
    this.#game.on('stateChanged', (s) => this.emit('gameStateChanged', s));
    this.#game.on('stateChanged', (s) => {
      if (s === undefined) return;
      // if game started or moved states, emit a convenience event
      if (s) this.emit('gameStateUpdate', s);
    });

    // helper to emit authoritative roomState to listeners
    this._emitRoomState = () => {
      const playersState = Array.from(this.players.values()).map((p) => ({ id: p.id, username: p.name, isReady: !!p.isReady, score: p.score || 0 }));
      this.emit('roomState', { players: playersState, creatorId: this.creatorId, creatorName: this.creatorName, judgeId: this.#game && this.#game.currentJudge ? this.#game.currentJudge.id : null });
    };

    // forward submission/judge events
    this.#game.on('submissionCount', (c) => this.emit('submissionCount', c));
    this.#game.on('submissionsReady', (list) => this.emit('submissionsReady', list));
    this.#game.on('roundWinner', (result) => this.emit('roundWinner', result));
    this.#game.on('judgeChanged', (judgeId) => this.emit('judgeChanged', judgeId));

    // forward deals and card events so the server broadcaster can emit to clients
    this.#game.on('handsDealt', (hands) => this.emit('handsDealt', hands));
    this.#game.on('blackCard', (card) => this.emit('blackCard', card));
    // forward player-submission events (used to push individual player hands immediately)
    this.#game.on('playerSubmitted', (p) => this.emit('playerSubmitted', p));
    // forward game end events
    this.#game.on('gameEnded', (result) => this.emit('gameEnded', result));

    // when a game ends, clear ready flags and broadcast updated room state
    this.#game.on('gameEnded', () => {
      // mark everyone unready
      const playersState = Array.from(this.players.values()).map((p) => {
        p.isReady = false;
        return { id: p.id, username: p.name, isReady: !!p.isReady, score: p.score || 0 };
      });
      // emit a roomState event so server can broadcast it
      this.emit('roomState', { players: playersState, creatorId: this.creatorId, creatorName: this.creatorName, judgeId: null });
    });
  }

  get game() {
    return this.#game;
  }

  playCard(playerId, cardId) {
    return this.#game.playCard(playerId, cardId);
  }

  judgePick(judgeId, submissionId) {
    // defensive: ensure game instance exposes judgePick
    const game = this.#game;
    if (!game) {
      console.error('[room] judgePick called but game is missing', { gameType: typeof game });
      throw new Error('game_not_ready');
    }

    // prefer direct method call; if missing on instance, attempt prototype lookup and call
    if (typeof game.judgePick === 'function') {
      const res = game.judgePick(judgeId, submissionId);
      console.debug('[room] game.judgePick returned', res);
      try { this._emitRoomState(); } catch (e) { console.warn('Error emitting roomState after judgePick', e); }
      return res;
    }

    const proto = Object.getPrototypeOf(game);
    if (proto && typeof proto.judgePick === 'function') {
      console.debug('[room] invoking judgePick from game prototype');
      const res = proto.judgePick.call(game, judgeId, submissionId);
      try { this._emitRoomState(); } catch (e) { console.warn('Error emitting roomState after judgePick', e); }
      return res;
    }

    console.error('[room] judgePick called but game.judgePick is not available', { gameType: typeof game, gameKeys: game ? Object.keys(game) : null, protoHas: proto ? Object.getOwnPropertyNames(proto) : null });
    throw new Error('game_not_ready');
  }

  get gameState() {
    return this.#game.gameState;
  }
  addPlayer(player, password) {
    if (this.#password && this.#password !== password) {
      throw new Error('Invalid password');
    }
    // prevent same-name players (case-insensitive)
    const name = (player.name || '').toString().trim().toLowerCase();
    if (name) {
      const existing = Array.from(this.players.values()).find((p) => (p.name || '').toLowerCase() === name);
      if (existing) throw new Error('Player already in room');
      const existingSpec = Array.from(this.spectators.values()).find((p) => (p.name || '').toLowerCase() === name);
      if (existingSpec) throw new Error('Player already in room (spectator)');
    }

    if (this.#game.gameState !== GameState.WAITING_FOR_PLAYERS || this.players.size >= this.maxPlayers) {
      this.spectators.set(player.id, player);
    } else {
      this.players.set(player.id, player);
      this.emit('playerJoined', player);

      // attach listener to broadcast score changes live
      player.on('scoreUpdated', () => {
        try {
          console.debug('[room] player score updated', { playerId: player.id, score: player.score });
          this._emitRoomState();
        } catch (e) {
          console.warn('Error broadcasting roomState on score update', e);
        }
      });

      // if creatorId not set, and creatorName matches this player's name, assign it
      const pname = (player.name || '').toString().trim();
      if (!this.creatorId && this.creatorName && pname && pname.toLowerCase() === this.creatorName.toLowerCase()) {
        this.creatorId = player.id;
      }
      // also if first player, set as creator (fallback)
      if (!this.creatorId && this.players.size === 1) {
        this.creatorId = player.id;
        this.creatorName = player.name;
      }
    }
  }
  hasPlayer(playerId) {
    return this.players.has(playerId) || this.spectators.has(playerId);
  }

  startGame() {
    // expose a method to start the game
    this.#game.start();
    this.emit('gameStarted', { currentJudge: this.#game.currentJudge && this.#game.currentJudge.id });
  }

  removePlayer(playerId) {
    // cleanup score listeners and emit playerLeft
    const p = this.players.get(playerId);
    if (p) {
      try {
        p.removeAllListeners('scoreUpdated');
      } catch (e) {
        console.warn('Error removing score listeners for', playerId, e);
      }
    }
    this.emit('playerLeft', p);
    this.players.delete(playerId);
    this.spectators.delete(playerId);
  }
}

export default Room;
