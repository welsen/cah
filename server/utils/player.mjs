import { EventEmitter } from 'events';
import { generateHashedPlayerId } from './generateHashedPlayerId.mjs';

class Player extends EventEmitter {
  constructor(name) {
    super();
    this.id = generateHashedPlayerId();
    this.name = name;
    this.hand = [];
    this.isReady = false;
    this.score = 0; // track points won
  }
  ready() {
    this.isReady = true;
    this.emit('ready', this.id);
  }
  awardPoint(points = 1) {
    this.score = (this.score || 0) + Number(points || 1);
    this.emit('scoreUpdated', { playerId: this.id, score: this.score });
    return this.score;
  }

  // reset player score to zero and notify listeners
  resetScore() {
    this.score = 0;
    this.emit('scoreUpdated', { playerId: this.id, score: this.score });
  }
}

export default Player;
