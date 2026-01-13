import { EventEmitter } from 'events';
import { GameState } from './gameState.enum.mjs';
import * as decks from '../../cah-cards-full.json' with { type: 'json' };

function generateId(prefix = ''){ return prefix + Math.random().toString(36).slice(2,9); }

class Game extends EventEmitter {
  blackDeck;
  whiteDeck;
  currentJudge;
  currentBlackCard;
  gameState;

  constructor(room, maxScore = 10, selectedCardPacks = []) {
    super();
    this.room = room;
    this.gameState = GameState.WAITING_FOR_PLAYERS;
    room.on('playerJoined', this.onPlayerJoined.bind(this));
    room.on('playerLeft', this.onPlayerLeft.bind(this));

    // default hand size
    this.handSize = 10;

    // score required to win the game
    this.winningScore = process.env.DEBUG === 'true' ? 2 : maxScore; // reduced for faster games
    this.selectedCardPacks = selectedCardPacks;

    // submissions map: submissionId -> { id, playerId, card }
    this.submissions = new Map();

    // discard piles (cards removed from play permanently)
    this.whiteDiscard = [];
    this.blackDiscard = [];
  }

  onPlayerJoined(player) {
    player.on('ready', () => {
      // Check if all players are ready and start the game
      if ([...this.room.players.values()].every(p => p.isReady)) {
        // emit an event rather than directly starting; server may choose to auto-start
        this.emit('allPlayersReady');
      }
    });
  }

  onPlayerLeft(player) {
    // Handle player leaving
    player.removeAllListeners('ready');
    // remove any submissions from this player
    for(const [sid, sub] of this.submissions.entries()){
      if(sub.playerId === player.id) this.submissions.delete(sid);
    }
  }

  start() {
    // reset player scores at the start of a new game
    try {
      for (const player of this.room.players.values()) {
        if (player && typeof player.resetScore === 'function') {
          player.resetScore();
        } else if (player) {
          // fallback: set score directly and emit event so room can broadcast
          player.score = 0;
          player.emit && typeof player.emit === 'function' && player.emit('scoreUpdated', { playerId: player.id, score: 0 });
        }
      }
    } catch (e) {
      console.warn('[game] error resetting player scores on start', e);
    }

    this.gameState = GameState.SELECTING_FIRST_JUDGE;
    this.emit('stateChanged', this.gameState);
    this.currentJudge = this.selectFirstJudge();
    this.dealCards();
    // notify current judge
    this.emit('judgeChanged', this.currentJudge && this.currentJudge.id);
  }

  selectFirstJudge() {
    const players = Array.from(this.room.players.values());
    return players[Math.floor(Math.random() * players.length)];
  }

  initDecks() {
    // Build black and white decks from the imported JSON using the Base Set pack
    const all = typeof decks === 'object' && decks.default ? decks.default : decks;

    let basePack = null;
    if (Array.isArray(all)) {
      console.debug('[game] initializing decks with selected card packs', this.selectedCardPacks);
      if (this.selectedCardPacks && this.selectedCardPacks.length > 0) {
        // selectedPacks is a list of pack indexes
        const selectedPacks = this.selectedCardPacks.map(idx => {
          const i = parseInt(idx, 10);
          return (i >= 0 && i < all.length) ? all[i] : null;
        }).filter(Boolean);
        basePack = {
          white: selectedPacks.flatMap(p => p.white || []),
          black: selectedPacks.flatMap(p => p.black || []),
        };
      } else {
        basePack = all.find(p => p && (p.name === 'CAH Base Set' || p.name === 'Base Set' || p.name && p.name.toLowerCase().includes('base set')));
        if (!basePack) basePack = all[0]; // fallback to first pack
      }
    }

    const whiteSrc = (basePack && Array.isArray(basePack.white) && basePack.white.length) ? basePack.white : [];
    const blackSrc = (basePack && Array.isArray(basePack.black) && basePack.black.length) ? basePack.black : [];

    // fallback: if we didn't find arrays in a single pack, flatten all packs
    if (whiteSrc.length === 0 || blackSrc.length === 0) {
      const whites = [];
      const blacks = [];
      if (Array.isArray(all)) {
        for (const p of all) {
          if (p && Array.isArray(p.white)) whites.push(...p.white);
          if (p && Array.isArray(p.black)) blacks.push(...p.black);
        }
      }
      if (whiteSrc.length === 0) whiteSrc.push(...whites);
      if (blackSrc.length === 0) blackSrc.push(...blacks);
    }

    // map to internal card shape and add ids
    this.whiteDeck = (whiteSrc || []).map((c) => ({ id: c.id || generateId('w_'), text: c.text || String(c), pack: c.pack }));
    this.blackDeck = (blackSrc || []).map((c) => ({ id: c.id || generateId('b_'), text: c.text || String(c), pick: c.pick || 1, pack: c.pack }));

    // filter out any cards that have been discarded (removed from the game)
    try {
      const whiteDiscardIds = new Set((this.whiteDiscard || []).map(c => c && c.id).filter(Boolean));
      if (whiteDiscardIds.size) this.whiteDeck = this.whiteDeck.filter(c => !whiteDiscardIds.has(c.id));
      const blackDiscardIds = new Set((this.blackDiscard || []).map(c => c && c.id).filter(Boolean));
      if (blackDiscardIds.size) this.blackDeck = this.blackDeck.filter(c => !blackDiscardIds.has(c.id));
    } catch (e) {
      console.warn('[game] error filtering discards during initDecks', e);
    }

    // shuffle decks
    this.shuffle(this.blackDeck);
    this.shuffle(this.whiteDeck);
  }

  shuffle(arr){
    for(let i = arr.length -1; i>0; i--){
      const j = Math.floor(Math.random() * (i+1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
  }

  // For 2-player games: draw white cards from deck and auto-submit for the non-judge player
  performTwoPlayerAutoSubmit(){
    try {
      if (!this.room || !this.room.players || this.room.players.size !== 2 || !this.currentJudge) return;
      const players = Array.from(this.room.players.values());
      const nonJudge = players.find(p => p.id !== (this.currentJudge && this.currentJudge.id));
      const pick = (this.currentBlackCard && this.currentBlackCard.pick) ? this.currentBlackCard.pick : 1;

      if (!this.whiteDeck || this.whiteDeck.length === 0) {
        this.initDecks();
      }
      if (this.whiteDeck.length < pick) this.initDecks();

      if (this.whiteDeck && this.whiteDeck.length > 0) {
        const num = Math.min(pick, this.whiteDeck.length);
        const selected = [];
        for (let i = 0; i < num; i++) {
          const card = this.whiteDeck.pop();
          card.id = card.id || generateId('w_');
          selected.push(card);
        }
        const submission = { id: generateId('s_'), playerId: null, card: selected, auto: true };
        this.submissions.set(submission.id, submission);
        const required = (this.room.players.size === 2) ? 2 : Math.max(0, this.room.players.size - 1);
        this.emit('submissionCount', { count: this.submissions.size, required });
        this.emit('playerSubmitted', { playerId: null, submissionId: submission.id, auto: true });
        console.debug('[game] auto-submitted anonymous card(s) from deck for two-player match', { roomId: this.room && this.room.id, submissionId: submission.id });
      } else {
        console.warn('[game] auto-submit skipped: no white cards available in deck');
      }
    } catch (e) {
      console.error('[game] performTwoPlayerAutoSubmit error', e);
    }
  }

  dealCards() {
    this.gameState = GameState.DEALING_CARDS;
    this.emit('stateChanged', this.gameState);

    if(!this.blackDeck || !this.whiteDeck || this.whiteDeck.length < 1 || this.blackDeck.length < 1) this.initDecks();

    // draw a black card
    this.currentBlackCard = this.blackDeck.pop();

    // deal hands to players, reset ready flags
    const hands = {};
    for(const player of this.room.players.values()){
      player.hand = player.hand || [];
      // ensure cards have ids for selection tracking
      while(player.hand.length < this.handSize && this.whiteDeck.length){
        const card = this.whiteDeck.pop();
        card.id = card.id || generateId('w_');
        player.hand.push(card);
      }
      // NOTE: Do not reset players' ready state here — ready should only be reset when the game ends.
      hands[player.id] = player.hand.slice(); // copy
    }

    // clear any lingering submissions
    this.submissions.clear();

    // emit events for server to broadcast (room handlers will forward to sockets)
    this.emit('handsDealt', { hands });
    this.emit('blackCard', this.currentBlackCard);

    // enter in-progress state
    this.gameState = GameState.IN_PROGRESS;
    this.emit('stateChanged', this.gameState);

    // Special case: when only two players, auto-submit white cards FROM THE DECK (not removed from player's hand) matching the black pick
    this.performTwoPlayerAutoSubmit();
  }

  // player plays a card (returns submission id)
  playCard(playerId, cardIdOrArray){
    if(this.gameState !== GameState.IN_PROGRESS) throw new Error('Game not in progress');
    if(!playerId || !cardIdOrArray) throw new Error('missing_params');
    const player = this.room.players.get(playerId);
    if(!player) throw new Error('player_not_in_room');
    if(this.currentJudge && this.currentJudge.id === playerId) throw new Error('judge_cannot_play');

    // determine required pick for current black card
    const pick = (this.currentBlackCard && this.currentBlackCard.pick) ? this.currentBlackCard.pick : 1;

    // normalize incoming selection to an array of cardIds
    const cardIds = Array.isArray(cardIdOrArray) ? cardIdOrArray : [cardIdOrArray];
    if(cardIds.length !== pick) throw new Error('invalid_selection_count');

    // determine indices for each requested card and validate ownership
    const cidIndexPairs = cardIds.map((cid) => {
      const idx = player.hand.findIndex(c => c && c.id === cid);
      if (idx === -1) throw new Error('card_not_in_hand');
      return { cid, idx };
    });

    // ensure player hasn't already submitted (only consider explicit player submissions)
    const already = Array.from(this.submissions.values()).find(s => s.playerId === playerId);
    if (already) throw new Error('already_submitted');

    // remove cards from hand by descending index to avoid shifting issues, but remember removed cards by id
    const pairsDesc = cidIndexPairs.slice().sort((a,b) => b.idx - a.idx);
    const removedMap = new Map();
    for (const { cid, idx } of pairsDesc) {
      const removed = player.hand.splice(idx, 1)[0];
      removedMap.set(cid, removed);
    }

    // preserve the original selection order when building the submission
    const removedCards = cardIds.map((cid) => removedMap.get(cid));

    const submission = { id: generateId('s_'), playerId, card: removedCards };
    this.submissions.set(submission.id, submission);
    console.debug('[game] player submitted', { roomId: this.room && this.room.id, playerId, submissionId: submission.id, removedCount: removedCards.length, required: pick });

    // notify listeners that this particular player has submitted
    this.emit('playerSubmitted', { playerId, submissionId: submission.id, auto: false });

    // broadcast submission count
    const required = (this.room.players.size === 2) ? 2 : Math.max(0, this.room.players.size - 1);
    this.emit('submissionCount', { count: this.submissions.size, required });

    // if all required submissions are in, notify judge with anonymized submissions
    if(this.submissions.size >= required){
      // randomize order for judge
      const list = Array.from(this.submissions.values()).map(s => {
        const text = Array.isArray(s.card) ? s.card.map(c=>c.text || '').join(' / ') : (s.card && (s.card.text || s.card.title || ''));
        return ({ id: s.id, text, playerId: s.playerId });
      });
      // shuffle
      for (let i = list.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [list[i], list[j]] = [list[j], list[i]];
      }
      // omit playerId when sending to judge UI (but keep id for mapping server-side)
      const anonymized = list.map(s => ({ id: s.id, text: s.text }));
      // include current black card so the judge dialog can show the black text
      this.emit('submissionsReady', { submissions: anonymized, black: this.currentBlackCard });
    }
    // no immediate award on playCard: winner selection must be performed by judge via judgePick

    // We've reached the end of the submission side-effect handling for playCard.
    // The actual round resolution (moving submitted cards to discards, awarding points,
    // dealing replacement cards and drawing the new black) is performed in `judgePick`.

    return { ok: true };
  }

  // judge picks a winning submission; this resolves the round and prepares the next
  judgePick(judgePlayerId, submissionId){
    console.debug('[game] judgePick called', { roomId: this.room && this.room.id, judgePlayerId, submissionId });
    if(this.gameState !== GameState.IN_PROGRESS) throw new Error('Game not in progress');
    if(!this.currentJudge || this.currentJudge.id !== judgePlayerId) throw new Error('not_authorized');
    if(!this.submissions.has(submissionId)) throw new Error('submission_not_found');

    const submission = this.submissions.get(submissionId);

    // handle auto-submission case (two-player auto submit) — may not have a playerId
    if (submission && submission.auto) {
      console.debug('[game] judgePick picked an AUTO submission', { submissionId });
      // do not award point
      this.emit('roundWinner', { winnerId: null, winnerName: null, noPointAwarded: true, card: submission.card, scores: Array.from(this.room.players.values()).map(p => ({ id: p.id, name: p.name, score: p.score })), whiteDiscardCount: this.whiteDiscard.length, blackDiscardCount: this.blackDiscard.length });

      // choose next judge in player order
      const players = Array.from(this.room.players.values());
      if (players.length > 0 && this.currentJudge) {
        const idx = players.findIndex(p => p.id === this.currentJudge.id);
        const nextIdx = (idx + 1) % players.length;
        this.currentJudge = players[nextIdx];
        this.emit('judgeChanged', this.currentJudge && this.currentJudge.id);
      }
    } else {
      // non-auto submission — determine winner and award point
      const winner = this.room.players.get(submission.playerId);
      if (!winner) throw new Error('winner_not_found');

      console.debug('[game] judgePick awarding point to', { winnerId: winner.id });
      // award point
      const newScore = winner.awardPoint(1);

      // inform listeners about round result
      this.emit('roundWinner', { winnerId: winner.id, winnerName: winner.name, card: submission.card, scores: Array.from(this.room.players.values()).map(p => ({ id: p.id, name: p.name, score: p.score })), whiteDiscardCount: this.whiteDiscard.length, blackDiscardCount: this.blackDiscard.length });

      // if winner reached the winning score, end the game now
      if (newScore >= this.winningScore) {
        this.gameState = GameState.GAME_ENDED;
        this.emit('stateChanged', this.gameState);

        // move submitted cards to discards
        for (const s of this.submissions.values()) {
          if (!s || !s.card) continue;
          if (Array.isArray(s.card)) {
            for (const c of s.card) {
              if (c && c.id) this.whiteDiscard.push(c);
            }
          } else {
            if (s.card && s.card.id) this.whiteDiscard.push(s.card);
          }
        }

        // move current black card to discard
        if (this.currentBlackCard && this.currentBlackCard.id) {
          this.blackDiscard.push(this.currentBlackCard);
        }

        // clear players' hands and unready them (only on game end)
        for (const player of this.room.players.values()) {
          player.hand = [];
          player.isReady = false;
        }

        // reset judge
        this.currentJudge = null;
        this.emit('judgeChanged', null);

        // emit final empty hands and gameEnded event
        const hands = {};
        for (const player of this.room.players.values()) {
          hands[player.id] = player.hand.slice();
        }
        this.emit('handsDealt', { hands });
        this.emit('gameEnded', { winnerId: winner.id, winnerName: winner.name, scores: Array.from(this.room.players.values()).map(p => ({ id: p.id, name: p.name, score: p.score })), whiteDiscardCount: this.whiteDiscard.length, blackDiscardCount: this.blackDiscard.length });

        // clear submissions and stop here
        this.submissions.clear();
        return { ok: true, gameEnded: true };
      } else {
        // set winner as next judge
        this.currentJudge = winner;
        this.emit('judgeChanged', this.currentJudge && this.currentJudge.id);
      }
    }

    // move all submitted white cards to discard pile so they are removed from the game permanently
    for (const s of this.submissions.values()) {
      if (!s || !s.card) continue;
      if (Array.isArray(s.card)) {
        for (const c of s.card) {
          if (c && c.id) this.whiteDiscard.push(c);
        }
      } else {
        if (s.card && s.card.id) this.whiteDiscard.push(s.card);
      }
    }

    // move the current black card to the black discard pile
    if (this.currentBlackCard && this.currentBlackCard.id) {
      this.blackDiscard.push(this.currentBlackCard);
    }
    console.debug('[game] moved played cards to discards', { whiteDiscard: this.whiteDiscard.length, blackDiscard: this.blackDiscard.length });

    // prepare for next round by dealing replacement cards and new black card
    for(const player of this.room.players.values()){
      while(player.hand.length < this.handSize && this.whiteDeck.length){
        const card = this.whiteDeck.pop();
        card.id = card.id || generateId('w_');
        player.hand.push(card);
      }
    }

    // clear submissions for next round
    this.submissions.clear();

    // emit updated hands to players
    const hands = {};
    for(const player of this.room.players.values()){
      hands[player.id] = player.hand.slice();
    }
    this.emit('handsDealt', { hands });

    // draw a fresh black card for next round
    if(!this.blackDeck || this.blackDeck.length < 1) this.initDecks();
    this.currentBlackCard = this.blackDeck.pop();
    this.emit('blackCard', this.currentBlackCard);

    // after dealing a new black card, in 2-player games the system should perform an anonymous auto-submit for the non-judge
    this.performTwoPlayerAutoSubmit();

    return { ok: true };
  }
}

export default Game;