// Room UI module
// This file contains the JS that was previously in the template inline <script>.
// It initializes the room UI, wires Ready button behavior, and listens for socket events.

import { showToast } from '../../utils/showToast.mjs';

function escapeHtml(str) {
  return String(str || '').replace(/[&<>"]+/g, (s) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[s]));
}

export function initRoom(app) {
  const root = document.querySelector('.room');
  if (!root) return;

  const maxPlayers = parseInt(root.dataset.maxPlayers, 10) || 2;
  const selections = document.querySelector('.selections');
  const hand = document.querySelector('.player-hand');

  // Initially leave selections empty; they'll be rendered when submissions start (submissionCount event)
  if (selections) {
    selections.innerHTML = '';
  }

  // Hand area starts empty; we'll render real cards when the server sends 'playerHand'
  if (hand) {
    hand.innerHTML = '';
  }

  // track whether the local player has submitted this round (prevents double-submits)
  let hasSubmitted = false;
  // track selected cards when black card requires multiple picks
  let selectedCards = new Set();

  function clearSelectionUI() {
    selectedCards.clear();
    document.querySelectorAll('.hand-card.selected').forEach((el) => el.classList.remove('selected'));
    // remove selection counter if present
    if (root) {
      const handCol = root.querySelector('.hand-column');
      if (handCol) {
        const counter = handCol.querySelector('.selection-counter');
        if (counter) counter.remove();
      }
    }
  }

  // update or remove the selection counter shown above the hand
  function updateSelectionCounter(requiredPick) {
    if (!root) return;
    const handCol = root.querySelector('.hand-column');
    if (!handCol) return;
    let counter = handCol.querySelector('.selection-counter');
    try {
      if (!counter) {
        counter = document.createElement('div');
        counter.className = 'selection-counter small muted';
        handCol.insertBefore(counter, handCol.querySelector('.player-hand'));
      }
    } catch (_e) {}
    const pick =
      typeof requiredPick === 'number' ? requiredPick : parseInt(root.dataset.currentBlackPick || '1', 10) || 1;
    counter.textContent = `Selected ${selectedCards.size} / ${pick}`;
    if (selectedCards.size === 0 && counter) counter.remove();
  }

  // Toggle Ready state optimistically, disable button and wait for server ack
  function toggleReadyHandler(e) {
    const btn = e.currentTarget;
    const li = btn.closest('.player');
    if (!li) return;
    const indicator = li.querySelector('.player-indicator');
    const willBeReady = !li.classList.contains('player-ready');

    // optimistic UI change
    li.classList.toggle('player-ready');
    if (indicator) {
      indicator.classList.toggle('ready', willBeReady);
      indicator.title = willBeReady ? 'Ready' : 'Not ready';
    }
    btn.textContent = li.classList.contains('player-ready') ? 'Unready' : 'Ready';

    // send to server with acknowledgement and show pending state
    const playerId = btn.dataset.playerId;
    const roomId = window.location.pathname.split('/')[1];
    if (app && app.socket && playerId) {
      btn.disabled = true;
      btn.classList.add('pending');

      const payload = { roomId, playerId, ready: willBeReady };
      const socket = app.socket;

      let handled = false;
      socket.timeout(5000).emit('playerReady', payload, (err, resp) => {
        handled = true;
        btn.classList.remove('pending');
        if (err) {
          // revert optimistic UI and re-enable button
          console.error('playerReady ack error:', err);
          li.classList.toggle('player-ready');
          if (indicator) {
            indicator.classList.toggle('ready', !willBeReady);
            indicator.title = !willBeReady ? 'Ready' : 'Not ready';
          }
          btn.textContent = li.classList.contains('player-ready') ? 'Unready' : 'Ready';
          btn.disabled = false;
          btn.animate(
            [{ transform: 'translateY(0)' }, { transform: 'translateY(-6px)' }, { transform: 'translateY(0)' }],
            { duration: 300 }
          );

          showToast('Failed to update ready state: ' + (err && err.message ? err.message : 'timeout'), {
            type: 'error',
            actionLabel: 'Retry',
            action: () => {
              // retry by simulating a click
              btn.click();
            },
          });

          // try to resync by re-registering for room state
          const sessionPlayerId = sessionStorage.getItem('playerId');
          if (sessionPlayerId && roomId) {
            socket.emit('register', { roomId, playerId: sessionPlayerId });
          }
        } else {
          // success: server will broadcast 'playerReady' and 'readyCount'; leave button disabled until that event updates it
        }
      });

      // fallback: if no callback called after timeout (rare), ensure UI isn't stuck
      setTimeout(() => {
        if (!handled) {
          btn.classList.remove('pending');
          btn.disabled = false;
          li.classList.toggle('player-ready');
          if (indicator) {
            indicator.classList.toggle('ready', !willBeReady);
            indicator.title = !willBeReady ? 'Ready' : 'Not ready';
          }
          btn.textContent = li.classList.contains('player-ready') ? 'Unready' : 'Ready';
          showToast('Request timed out — changes reverted', { type: 'error' });
          const sessionPlayerId = sessionStorage.getItem('playerId');
          if (sessionPlayerId && roomId) {
            socket.emit('register', { roomId, playerId: sessionPlayerId });
          }
        }
      }, 5500);
    }
  }
  // Enable only the current player's Ready button (others disabled)
  function enableLocalReadyButton() {
    const myId = sessionStorage.getItem('playerId');
    const root = document.querySelector('.room');
    const judgeId = root && root.dataset && root.dataset.currentJudge ? root.dataset.currentJudge : '';
    document.querySelectorAll('.btn-ready').forEach((b) => {
      const pid = b.dataset.playerId;
      if (!pid || !myId || pid !== myId) {
        b.disabled = true;
        b.classList.add('disabled');
      } else {
        b.disabled = false;
        b.classList.remove('disabled');
        // prevent duplicate listeners by removing first
        b.removeEventListener('click', toggleReadyHandler);
        b.addEventListener('click', toggleReadyHandler);
      }
    });

    // re-evaluate hand card playability depending on whether local player is judge
    const handCards = document.querySelectorAll('.hand-card');
    handCards.forEach((card) => {
      if (!myId || myId === judgeId) {
        card.classList.remove('playable');
        card.classList.remove('selectable');
        card.onclick = null;
      } else if (!card.classList.contains('submitted')) {
        const pick =
          parseInt(root && root.dataset && root.dataset.currentBlackPick ? root.dataset.currentBlackPick : '1', 10) ||
          1;
        if (pick <= 1) {
          card.classList.add('playable');
          card.classList.remove('selectable');
          card.onclick = () => playCardHandler(card);
        } else {
          card.classList.add('selectable');
          card.classList.remove('playable');
          card.onclick = () => toggleSelectCard(card);
        }
      }
    });
  }

  // submit a selection of cards (one or many depending on black pick)
  function submitSelection(cardIds, cardEls) {
    if (!Array.isArray(cardIds) || cardIds.length === 0) return;
    const myId = sessionStorage.getItem('playerId');
    const roomId = window.location.pathname.split('/')[1];
    if (!myId || !roomId) return;

    // Defensive quick-check: ensure the current black pick matches the number of selected cards
    const root = document.querySelector('.room');
    const pick =
      parseInt(root && root.dataset && root.dataset.currentBlackPick ? root.dataset.currentBlackPick : '1', 10) || 1;
    if (cardIds.length !== pick) {
      showToast('You must submit ' + pick + ' card' + (pick > 1 ? 's' : '') + ' for this black card', {
        type: 'warning',
      });
      // clear any selected CSS
      (cardEls || []).forEach((el) => el.classList.remove('selected'));
      return;
    }

    // optimistic UI and lock submissions locally
    hasSubmitted = true;
    // mark selected elements as submitted
    (cardEls || []).forEach((el) => {
      el.classList.add('submitted');
      el.classList.remove('selected');
      el.classList.remove('playable');
    });

    console.debug('[client] emitting playCard', { roomId, playerId: myId, cardIds });
    app.socket.timeout(5000).emit('playCard', { roomId, playerId: myId, cardId: cardIds }, (err, resp) => {
      console.debug('[client] playCard ack callback', { err, resp });
      if (err) {
        const code = err && (err.error || err.message) ? err.error || err.message : String(err);
        const expected = [
          'already_submitted',
          'judge_cannot_play',
          'card_not_in_hand',
          'Game not in progress',
          'invalid_selection_count',
        ];
        if (expected.includes(code)) {
          console.debug('playCard rejected (expected):', code);
          if (code === 'already_submitted') {
            showToast('You already submitted a card for this round', { type: 'warning' });
            // sync hand from server to ensure UI reflects actual hand/submitted state
            if (myId && roomId) {
              app.socket.timeout(5000).emit('requestHand', { roomId, playerId: myId }, (rErr, rResp) => {
                if (rErr) console.warn('requestHand failed', rErr);
                else console.debug('requestHand resynced hand after duplicate submit');
              });
            }
            // leave selection marked until resync
          } else if (code === 'judge_cannot_play') {
            showToast('You are the judge and cannot play a card', { type: 'warning' });
            // revert local change
            hasSubmitted = false;
            (cardEls || []).forEach((el) => {
              el.classList.remove('submitted');
              el.classList.add('playable');
            });
          } else if (code === 'card_not_in_hand') {
            showToast('One of those cards is not in your hand', { type: 'error' });
            // request a fresh hand to be safe
            if (myId && roomId) {
              app.socket.timeout(5000).emit('requestHand', { roomId, playerId: myId }, (rErr, rResp) => {
                if (rErr) console.warn('requestHand failed', rErr);
              });
            }
            // clear local selection state
            hasSubmitted = false;
            (cardEls || []).forEach((el) => el.remove());
          } else if (code === 'invalid_selection_count') {
            showToast('Selection mismatch: the black card requires ' + pick + ' card(s)', { type: 'warning' });
            // revert optimistic state so user can reselect
            hasSubmitted = false;
            (cardEls || []).forEach((el) => {
              el.classList.remove('submitted');
              el.classList.add('playable');
            });
          } else {
            showToast('Failed to play card(s): ' + code, { type: 'error' });
            hasSubmitted = false;
            (cardEls || []).forEach((el) => {
              el.classList.remove('submitted');
              el.classList.add('playable');
            });
          }
        } else {
          console.error('playCard error:', err);
          showToast('Failed to play card(s): ' + (err && err.error ? err.error : 'timeout'), { type: 'error' });
          // revert
          (cardEls || []).forEach((el) => {
            el.classList.remove('submitted');
            el.classList.add('playable');
          });
        }
      } else {
        // server will send updated hands in handsDealt — local removal already shown via submitted state
      }
    });
  }

  // Player plays a card from their hand (single-card convenience wrapper)
  function playCardHandler(cardEl) {
    const root = document.querySelector('.room');
    const pick =
      parseInt(root && root.dataset && root.dataset.currentBlackPick ? root.dataset.currentBlackPick : '1', 10) || 1;
    console.debug('[client] playCardHandler clicked', {
      cardId: cardEl && cardEl.dataset && cardEl.dataset.cardId,
      currentBlackPick: pick,
    });
    submitSelection([cardEl.dataset.cardId], [cardEl]);
  }

  function leaveRoom() {
    const myId = sessionStorage.getItem('playerId');
    const roomId = window.location.pathname.split('/')[1];
    try {
      if (myId && roomId && app && app.socket) {
        // fire-and-forget: we don't block on ack, but we attempt to inform server
        app.socket.timeout(5000).emit('leaveRoom', { roomId, playerId: myId }, (err, resp) => {
          if (err) console.warn('leaveRoom failed (ack)', err);
          // clear local session state immediately to avoid accidental reconnects
          try {
            sessionStorage.removeItem('playerId');
            sessionStorage.removeItem('roomId');
          } catch (_e) {}
        });
      }
    } catch (e) {
      console.warn('Error performing leaveRoom emit', e);
    } finally {
      // navigate home regardless of server response
      window.location.href = '/';
    }
  }

  // toggle card selection for multi-pick black cards
  function toggleSelectCard(cardEl) {
    if (!cardEl || cardEl.classList.contains('submitted')) return;
    if (!root) return;
    const pick = parseInt(root.dataset.currentBlackPick || '1', 10) || 1;
    console.debug('[client] toggleSelectCard start', {
      cardId: cardEl && cardEl.dataset && cardEl.dataset.cardId,
      pick,
      selectedNow: selectedCards.size,
    });

    // defensive: if pick <= 1 but toggle was accidentally wired, treat as single-play
    if (pick <= 1) {
      console.debug('[client] toggleSelectCard: pick <= 1 — delegating to single play');
      playCardHandler(cardEl);
      return;
    }
    const cardId = cardEl.dataset.cardId;
    if (!cardId) return;
    if (cardEl.classList.contains('selected')) {
      cardEl.classList.remove('selected');
      selectedCards.delete(cardId);
    } else {
      if (selectedCards.size >= pick) {
        // prevent selecting more than allowed
        showToast('You can only select ' + pick + ' cards for this black card', { type: 'warning' });
        return;
      }
      cardEl.classList.add('selected');
      selectedCards.add(cardId);
    }

    // update counter UI
    updateSelectionCounter(pick);

    // if we've selected enough cards, auto-submit
    if (selectedCards.size === pick) {
      // collect elements and ids in the exact order the player selected them
      const ids = Array.from(selectedCards);
      const els = ids.map((id) => document.querySelector('.hand-card[data-card-id="' + id + '"]')).filter(Boolean);
      console.debug('[client] auto-submitting', { ids });
      // clear selection set immediately to prevent further selects
      selectedCards.clear();
      // refresh counter UI
      updateSelectionCounter(pick);
      submitSelection(ids, els);
    }
  }

  // Socket event setup (safe: remove prior handlers first)
  if (app && app.socket) {
    const socket = app.socket;
    console.info('[room] socket present, id=', socket && socket.id);

    // remove any previous listeners from earlier inits
    socket.off('playerReady');
    socket.off('readyCount');
    socket.off('roomState');
    socket.off('allReady');
    socket.off('creatorAllReady');
    socket.off('gameStarted');
    socket.off('blackCard');
    socket.off('playerHand');
    socket.off('submissionCount');
    socket.off('submissionsReady');
    socket.off('roundWinner');
    socket.off('judgeChanged');

    socket.offAny && socket.offAny();
    socket.onAny &&
      socket.onAny((ev, ...args) => {
        console.debug('[socket] event', ev, args);
      });

    // wire leave room button if present
    const leaveBtn = document.getElementById('leaveRoomBtn');
    if (leaveBtn) {
      leaveBtn.onclick = leaveRoom;
    }

    socket.on('playerReady', function ({ playerId, ready }) {
      console.debug('[room] playerReady', playerId, ready);
      window.roomUI &&
        typeof window.roomUI.setPlayerReady === 'function' &&
        window.roomUI.setPlayerReady(playerId, ready);
      // ensure local button state correctness after updates
      enableLocalReadyButton();
    });

    // when a new player joins, append them to the list and update counts
    socket.on('playerJoined', function ({ id, username }) {
      const root = document.querySelector('.room');
      if (!root) return;
      const list = root.querySelector('.player-list');
      if (!list) return;
      if (list.querySelector('[data-player-id="' + id + '"]')) return; // already present
      const li = document.createElement('li');
      li.className = 'player';
      li.dataset.playerId = id;
      li.innerHTML = `<div class="player-info"><div class="player-head"><span class="player-indicator" aria-hidden="true" title="Not ready"></span><div class="player-name">${escapeHtml(
        username || 'Player'
      )}</div></div><div class="player-selected small muted">Selected: <span class="selected-slot">—</span></div></div><div class="player-actions"><button class="btn btn-ghost btn-ready" data-player-id="${id}" type="button">Ready</button></div>`;

      // if this join corresponds to the current session's player, insert at front
      const myId = sessionStorage.getItem('playerId');
      if (myId && String(myId) === String(id)) {
        // populate initials for immediate feedback
        try {
          const indicator = li.querySelector('.player-indicator');
          if (indicator) {
            const initials = (username || 'P')
              .toString()
              .trim()
              .split(/\s+/)
              .map((s) => s[0])
              .slice(0, 2)
              .join('')
              .toUpperCase();
            indicator.textContent = initials;
            indicator.classList.add('has-initials');
          }
        } catch (e) {
          console.warn('Error setting player initials on join', e);
        }
        list.insertBefore(li, list.firstChild);
      } else {
        list.appendChild(li);
      }

      // update header counts
      const rc = root.querySelector('.ready-count');
      const rt = root.querySelector('.ready-total');
      if (rt) rt.textContent = String(parseInt(rt.textContent || '0', 10) + 1);
      const info = root.querySelector('.room-info');
      if (info) {
        // try to update the numeric count displayed
        info.textContent = info.textContent.replace(
          /Players:\s*\d+/,
          'Players: ' + parseInt(rt.textContent || '0', 10)
        );
      }

      enableLocalReadyButton();
    });

    socket.on('readyCount', function ({ readyCount, totalPlayers }) {
      const root = document.querySelector('.room');
      if (!root) return;
      const rc = root.querySelector('.ready-count');
      const rt = root.querySelector('.ready-total');
      if (rc) rc.textContent = String(readyCount);
      if (rt) rt.textContent = String(totalPlayers);
    });

    socket.on('roomState', function ({ players, creatorId, creatorName, judgeId } = {}) {
      if (!Array.isArray(players)) return;
      // render player list authoritatively and set ready states
      const root = document.querySelector('.room');
      // store creator metadata on the DOM for convenience
      if (root) {
        root.dataset.creatorId = creatorId || '';
        root.dataset.creatorName = creatorName || '';
        root.dataset.currentJudge = judgeId || '';
      }

      const list = root && root.querySelector('.player-list');
      if (list) {
        // render players authoritatively (no static judge placeholder)
        list.innerHTML = '';
        const myId = sessionStorage.getItem('playerId');
        // ensure current player (if present) is rendered first
        const ordered = Array.isArray(players) ? players.slice() : [];
        if (myId) {
          const idx = ordered.findIndex((p) => String(p.id) === String(myId));
          if (idx > 0) {
            const [me] = ordered.splice(idx, 1);
            ordered.unshift(me);
          }
        }
        ordered.forEach((player) => {
          const li = document.createElement('li');
          li.className = 'player';
          li.dataset.playerId = player.id;
          li.innerHTML = `<div class="player-info"><div class="player-head"><span class="player-indicator" aria-hidden="true" title="Not ready"></span><div class="player-name">${escapeHtml(
            player.username || 'Player'
          )} <span class="player-score small muted">${
            player.score || 0
          }</span></div></div><div class="player-role small muted"></div><div class="player-selected small muted">Selected: <span class="selected-slot">—</span></div></div><div class="player-actions"><button class="btn btn-ghost btn-ready" data-player-id="${
            player.id
          }" type="button">Ready</button></div>`;

          // mark judge on the actual player's row
          if (String(player.id) === String(judgeId)) {
            li.classList.add('player-judge');
            const roleNode = li.querySelector('.player-role');
            if (roleNode) roleNode.textContent = 'Card Czar';
          }

          // populate initials into indicator (compact on mobile)
          try {
            const indicator = li.querySelector('.player-indicator');
            if (indicator) {
              const initials = (player.username || 'P')
                .toString()
                .trim()
                .split(/\s+/)
                .map((s) => s[0])
                .slice(0, 2)
                .join('')
                .toUpperCase();
              indicator.textContent = initials;
              indicator.classList.add('has-initials');
              if (player.isReady) indicator.classList.add('ready');
            }
          } catch (e) {
            console.warn('Error setting player initials', e);
          }

          list.appendChild(li);
        });
      }

      players.forEach(
        (p) =>
          window.roomUI &&
          typeof window.roomUI.setPlayerReady === 'function' &&
          window.roomUI.setPlayerReady(p.id, !!p.isReady)
      );

      // compute initial ready count and update header
      const readyCount = players.filter((p) => p.isReady).length;
      const total = players.length;
      if (root) {
        const rc = root.querySelector('.ready-count');
        const rt = root.querySelector('.ready-total');
        if (rc) rc.textContent = String(readyCount);
        if (rt) rt.textContent = String(total);

        // If not all players are ready, remove any selection placeholders or waiting hints
        if (readyCount !== total) {
          const selections = root.querySelector('.selections');
          if (selections) {
            selections.innerHTML = '';
          }
          const submissionInfo = root.querySelector('.submission-info');
          if (submissionInfo) submissionInfo.remove();
          const handStatus = root.querySelector('.hand-status');
          if (handStatus) handStatus.remove();
        }
      }
      // re-evaluate which button should be enabled for the current session
      enableLocalReadyButton();
    });

    socket.on('allReady', function () {
      const root = document.querySelector('.room');
      if (!root) return;
      root.classList.add('all-ready');
      const title = root.querySelector('.room-title');
      if (title)
        title.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.03)' }, { transform: 'scale(1)' }], {
          duration: 600,
        });
    });

    socket.on('creatorAllReady', function ({ roomId, creatorId }) {
      const myId = sessionStorage.getItem('playerId');
      if (!myId || myId !== creatorId) return;
      showToast('All players are ready — you can start the game', { type: 'success' });
      const root = document.querySelector('.room');
      if (root) {
        root.classList.add('creator-can-start');
        // show a Start Game button in the header
        const header = root.querySelector('.room-header');
        if (header && !document.getElementById('startGameBtn')) {
          const btn = document.createElement('button');
          btn.id = 'startGameBtn';
          btn.className = 'btn btn-primary';
          btn.textContent = 'Start Game';
          btn.addEventListener('click', startGameHandler);
          header.appendChild(btn);
        }
      }
    });

    // when the game starts (broadcast to all clients)
    socket.on('gameStarted', function (info) {
      const root = document.querySelector('.room');
      if (!root) return;
      root.classList.add('game-started');
      // clear any prior submission lock when a new game begins
      hasSubmitted = false;
      showToast('Game started', { type: 'success' });
      // remove start button for creator if present
      const startBtn = document.getElementById('startGameBtn');
      if (startBtn) {
        startBtn.remove();
      }

      // request the private hand explicitly in case we missed the server's push
      const myId = sessionStorage.getItem('playerId');
      const roomId = window.location.pathname.split('/')[1];
      if (myId && roomId) {
        app.socket.timeout(5000).emit('requestHand', { roomId, playerId: myId }, (err, resp) => {
          if (err) {
            console.warn('requestHand failed:', err);
          } else {
            console.debug('requestHand ok');
          }
        });
      }
    });

    // receive the black card for the round
    socket.on('blackCard', function (card) {
      const root = document.querySelector('.room');
      if (!root) return;
      const black = root.querySelector('.black-deck');
      if (black) {
        const pick = card && (card.pick || card.pick === 0) ? card.pick : 1;
        black.innerHTML = `<div class="card-face"><span class="card-text">${
          card && card.text ? escapeHtml(card.text) : 'Cards Against Humanity'
        }</span><div class="card-meta small muted">Pick: ${pick}</div></div>`;
        // store the current black text for later UI (round results) and pick
        root.dataset.currentBlackText = card && card.text ? card.text : '';
        root.dataset.currentBlackPick = String(pick);
        // update existing hand card click handlers so play/select mode changes immediately
        const myId = sessionStorage.getItem('playerId');
        const judgeId = root.dataset.currentJudge || '';
        document.querySelectorAll('.hand-card').forEach((cardDiv) => {
          // clear previous classes/handlers
          cardDiv.classList.remove('playable', 'selectable');
          cardDiv.onclick = null;
          if (myId && myId !== judgeId && !cardDiv.classList.contains('submitted')) {
            if (pick <= 1) {
              cardDiv.classList.add('playable');
              cardDiv.onclick = () => playCardHandler(cardDiv);
            } else {
              cardDiv.classList.add('selectable');
              cardDiv.onclick = () => toggleSelectCard(cardDiv);
            }
          }
        });
        // subtle pulse animation to draw attention
        black.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.03)' }, { transform: 'scale(1)' }], {
          duration: 600,
        });
        // remove any previous round result (clear from previous round)
        const prev = root.querySelector('.round-result');
        if (prev) prev.remove();
      }
    });

    // show a waiting hint if the game is already in progress and no hand arrives
    socket.on('gameState', function ({ state } = {}) {
      const root = document.querySelector('.room');
      if (!root) return;
      const inProgress = state === 'IN_PROGRESS' || state === 'DEALING_CARDS' || state === 'SELECTING_FIRST_JUDGE';
      if (inProgress) {
        // if there's no hand yet, show waiting hint and request hand after a short delay
        const myId = sessionStorage.getItem('playerId');
        const roomId = window.location.pathname.split('/')[1];
        // show waiting message unless a hand is present
        const handNode = root.querySelector('.player-hand');
        if (handNode && handNode.children.length === 0) {
          if (!root.querySelector('.hand-status')) {
            const s = document.createElement('div');
            s.className = 'hand-status small muted';
            s.textContent = 'Waiting for hand...';
            const handCol = root.querySelector('.hand-column');
            if (handCol) handCol.insertBefore(s, handCol.querySelector('.player-hand'));
          }
          // schedule a requestHand retry
          setTimeout(() => {
            if (myId && roomId) {
              app.socket.timeout(5000).emit('requestHand', { roomId, playerId: myId }, (err, resp) => {
                if (err) console.warn('requestHand retry failed', err);
                else console.debug('requestHand retry ok');
              });
            }
          }, 1100);
        }
      }
    });

    // receive my hand privately
    socket.on('playerHand', function ({ hand }) {
      console.debug('[room] playerHand received', hand);
      const root = document.querySelector('.room');
      if (!root) return;
      // remove waiting hint if present
      const wait = root.querySelector('.hand-status');
      if (wait) wait.remove();
      const handNode = root.querySelector('.player-hand');
      if (!handNode) return;
      // clear any prior selections when a new hand arrives
      clearSelectionUI();
      handNode.innerHTML =
        '<div class="hand-card card-spacer"></div><div class="hand-card card-spacer"></div>';
      const myId = sessionStorage.getItem('playerId');
      const judgeId = root.dataset.currentJudge || '';
      hand.forEach((card) => {
        const cardDiv = document.createElement('div');
        cardDiv.className = 'hand-card card-white';
        cardDiv.dataset.cardId = card && card.id ? card.id : '';
        // build accessible card face
        cardDiv.innerHTML = `<div class="card-face"><div class="card-text">${escapeHtml(
          card && card.text ? card.text : ''
        )}</div><div class="card-logo">Cards Against Humanity</div></div>`;
        // non-judge players can play or select cards depending on black pick
        if (myId && myId !== judgeId) {
          const pick = parseInt(root.dataset.currentBlackPick || '1', 10) || 1;
          // normalize classes and replace click handlers using `onclick` so we don't leave orphaned anonymous listeners
          cardDiv.classList.remove('playable', 'selectable');
          cardDiv.onclick = null;
          if (pick <= 1) {
            cardDiv.classList.add('playable');
            cardDiv.onclick = () => playCardHandler(cardDiv);
          } else {
            cardDiv.classList.add('selectable');
            cardDiv.onclick = () => toggleSelectCard(cardDiv);
          }
        }
        handNode.appendChild(cardDiv);
      });
      handNode.innerHTML +=
        '<div class="hand-card card-spacer"></div><div class="hand-card card-spacer"></div>'; // trigger reflow

      // debug: if hand arrived but contains placeholders, show full card array
      if (!hand || !hand.length) {
        console.warn('[room] empty hand received');
      }
    });

    // submission count updates — render only the remaining selection placeholders (hide already-selected slots)
    socket.on('submissionCount', function ({ count, required } = {}) {
      console.debug('[client] submissionCount', { count, required });
      const root = document.querySelector('.room');
      if (!root) return;
      const selections = root.querySelector('.selections');
      if (!selections) return;

      // defensive guard: don't show empty placeholders before game actually started
      const gameStarted = root.classList.contains('game-started') || !!root.dataset.currentBlackText;
      if (!gameStarted && (!count || count === 0)) {
        // ensure any stale placeholders are removed
        selections.innerHTML = '';
        const submissionInfo = root.querySelector('.submission-info');
        if (submissionInfo) submissionInfo.remove();
        return;
      }

      const totalRequired = required || Math.max(0, (root.dataset.maxPlayers || 4) - 1);

      selections.innerHTML = '';

      // also show a small info message
      let info = root.querySelector('.submission-info');
      if (!info) {
        info = document.createElement('div');
        info.className = 'submission-info small muted';
        selections.appendChild(info);
      }
      info.textContent = `${count || 0} / ${totalRequired} submissions received`;
    });

    // Judge receives anonymized submissions when all in
    socket.on('submissionsReady', function (payload = {}) {
      // payload is expected to be { judgeId, submissions: [...], black?: {...} }
      console.debug('[client] submissionsReady payload', payload);
      const myId = sessionStorage.getItem('playerId');
      const judgeId = payload && payload.judgeId ? String(payload.judgeId) : null;
      const submissions = Array.isArray(payload) ? payload : payload.submissions || [];
      const black = payload && payload.black ? payload.black : null;

      // ensure only the current judge opens the dialog
      if (!judgeId || !myId || String(myId) !== String(judgeId)) {
        console.debug('[submissionsReady] not the judge or missing judgeId; ignoring');
        return;
      }
      console.debug('[client] judge opening submissions dialog, submissionsCount=', (submissions || []).length);
      // set current judge in DOM to keep UI in sync and re-evaluate hand playability
      const root = document.querySelector('.room');
      if (root) {
        root.dataset.currentJudge = String(judgeId);
        enableLocalReadyButton();
      }

      const dialog = document.getElementById('judge-picks');
      if (!dialog) return;
      // ensure black area exists in dialog; create if missing
      let blackNode = dialog.querySelector('.judge-black');
      if (!blackNode) {
        blackNode = document.createElement('div');
        blackNode.className = 'judge-black';
        const container = dialog.querySelector('.dialog-content') || dialog;
        container.insertBefore(blackNode, container.querySelector('.judge-choices') || null);
      }
      blackNode.textContent = black && black.text ? black.text : root.dataset.currentBlackText || '';

      const choices = dialog.querySelector('.judge-choices');
      choices.innerHTML = '';

      // guard to prevent multiple picks
      let picking = false;

      (submissions || []).forEach((submission) => {
        const btn = document.createElement('button');
        btn.className = 'judge-choice';
        btn.type = 'button';
        btn.dataset.submissionId = submission.id;
        // if the submission contains multiple cards separated by ' / ', render them as stacked white card faces
        const parts = (submission.text || '').split(' / ');
        if (parts.length > 1) {
          btn.innerHTML = `<div class="card-stack">${parts
            .map(
              (p) =>
                `<div class="card-placeholder white small-card"><div class="card-face"><div class="card-text">${escapeHtml(
                  p
                )}</div></div></div>`
            )
            .join('')}</div>`;
        } else {
          btn.innerHTML = `<div class="card-face"><div class="card-text">${escapeHtml(
            submission.text || '—'
          )}</div></div>`;
        }
        btn.addEventListener('click', () => {
          if (picking) return;
          picking = true;
          // disable all choices immediately to prevent double picks
          Array.from(choices.querySelectorAll('.judge-choice')).forEach((b) => (b.disabled = true));
          // show picking state on selected button
          const old = btn.innerHTML;
          btn.innerHTML = '<div class="card-face"><div class="card-text">Picking…</div></div>';
          const myId = sessionStorage.getItem('playerId');
          app.socket
            .timeout(5000)
            .emit(
              'judgePick',
              { roomId: window.location.pathname.split('/')[1], playerId: myId, submissionId: submission.id },
              (err, resp) => {
                if (err) {
                  showToast('Failed to pick winner: ' + (err && err.error ? err.error : err), { type: 'error' });
                  // re-enable choices and restore state
                  Array.from(choices.querySelectorAll('.judge-choice')).forEach((b) => (b.disabled = false));
                  btn.innerHTML = old;
                  picking = false;
                } else {
                  showToast('Winner selected', { type: 'success' });
                  dialog.close();
                }
              }
            );
        });
        choices.appendChild(btn);
      });
      // wire cancel button (replace prior to avoid duplicates)
      const cancelBtn = dialog.querySelector('[data-action="cancel-judge"]');
      if (cancelBtn) {
        cancelBtn.onclick = null;
        cancelBtn.onclick = () => dialog.close();
      }
      dialog.showModal();
    });

    // when a player submits (server notifies to let clients lock out further submissions)
    socket.on('playerSubmitted', function ({ playerId, affectedPlayerId, submissionId, auto } = {}) {
      console.debug('[client] playerSubmitted event', { playerId, affectedPlayerId, submissionId, auto });
      const myId = sessionStorage.getItem('playerId');

      // Anonymous system autosubmits (playerId === null && auto) are SILENT — do not alter the local player's UI
      if (!playerId && auto) {
        console.debug('[client] anonymous system autopick — silent');
        // No toast, no locking, no visual change on any client's hand
      }

      // backward-compatible: if payload contains a playerId for a normal submission, update local UI for that player
      if (playerId) {
        const myId = sessionStorage.getItem('playerId');
        if (myId && String(myId) === String(playerId)) {
          hasSubmitted = true;
          if (auto) {
            showToast('A card was auto-selected for you', { type: 'info' });
          }
          document.querySelectorAll('.hand-card.playable, .hand-card.selectable').forEach((c) => {
            c.classList.remove('playable');
            c.classList.remove('selectable');
            c.classList.add('submitted');
            c.onclick = null;
          });
          // also clear any local selection UI
          clearSelectionUI();
        }
      }

      // visually mark the submitting player in the player list as "Submitted" (only for real player submissions)
      try {
        if (playerId) {
          const li = document.querySelector('.player[data-player-id="' + playerId + '"]');
          if (li) {
            const slot = li.querySelector('.player-selected .selected-slot');
            if (slot) slot.textContent = 'Submitted';
            li.classList.add('player-submitted');
          }
        }
      } catch (e) {
        console.warn('Error marking player as submitted in UI', e);
      }
    });

    // Round winner announcement
    socket.on(
      'roundWinner',
      function ({ winnerId, winnerName, card, scores, noPointAwarded, whiteDiscardCount, blackDiscardCount } = {}) {
        const root = document.querySelector('.room');
        if (!root) return;

        // clear submission lock for the local player (new round is starting)
        hasSubmitted = false;
        // clear selection UI
        clearSelectionUI();

        // ensure Start Game button is removed after a game ends and clear creator-start state
        const startBtn = document.getElementById('startGameBtn');
        if (startBtn) startBtn.remove();

        // immediately remove any submitted cards from local DOM so players see the table cleared
        try {
          document.querySelectorAll('.hand-card.submitted').forEach((el) => el.remove());
        } catch (e) {
          console.warn('Error removing submitted card nodes', e);
        }

        // update discard counts (if provided) and inform players that selected cards were removed from play
        if (typeof whiteDiscardCount !== 'undefined' || typeof blackDiscardCount !== 'undefined') {
          if (root) {
            if (typeof whiteDiscardCount !== 'undefined') root.dataset.whiteDiscardCount = String(whiteDiscardCount);
            if (typeof blackDiscardCount !== 'undefined') root.dataset.blackDiscardCount = String(blackDiscardCount);
          }
          showToast('Selected cards removed from play', { type: 'info' });
        }

        // clear submitted state on all players (prepare for next round)
        document.querySelectorAll('.player').forEach((li) => {
          const slot = li.querySelector('.player-selected .selected-slot');
          if (slot) slot.textContent = '—';
          li.classList.remove('player-submitted');
        });

        // show a prominent result area near the decks with black + winning white
        const decks = root.querySelector('.decks');
        if (decks) {
          // remove any previous
          const prev = root.querySelector('.round-result');
          if (prev) prev.remove();
        }

        if (noPointAwarded) {
          showToast('No points awarded — judge selected the auto-picked card', { type: 'warning' });
        } else {
          showToast('Round winner: ' + (winnerName || 'Player'), { type: 'success' });
        }

        // update score displays
        (scores || []).forEach((s) => {
          const li = root.querySelector('.player[data-player-id="' + s.id + '"]');
          if (li) {
            let scoreNode = li.querySelector('.player-score');
            if (!scoreNode) {
              scoreNode = document.createElement('span');
              scoreNode.className = 'player-score small muted';
              li.querySelector('.player-name').appendChild(scoreNode);
            }

            scoreNode.textContent = s.score;
          }
        });

        // animate winner if there is one
        if (!noPointAwarded && winnerId) {
          const winnerEl = root.querySelector('.player[data-player-id="' + winnerId + '"]');
          if (winnerEl) {
            winnerEl.animate([{ transform: 'scale(1.02)' }, { transform: 'scale(1)' }], { duration: 600 });
          }
        }
      }
    );

    // game ended — show final winner and disable further play
    socket.on('gameEnded', function ({ winnerId, winnerName, scores, whiteDiscardCount, blackDiscardCount } = {}) {
      const root = document.querySelector('.room');
      if (!root) return;
      root.classList.add('game-ended');
      // show prominent message
      showToast('Game over — Winner: ' + (winnerName || 'Player'), { type: 'success' });

      // clear selection UI and disable hand buttons
      hasSubmitted = false;
      clearSelectionUI();
      document.querySelectorAll('.hand-card').forEach((c) => {
        c.classList.remove('playable');
        c.onclick = null;
      });

      // ensure Start Game button is removed after a game ends and clear creator-start state
      const startBtn = document.getElementById('startGameBtn');
      if (startBtn) startBtn.remove();
      root.classList.remove('creator-can-start');
      // clear local hand display
      try {
        const handNode = document.querySelector('.player-hand');
        if (handNode) handNode.innerHTML = '';
      } catch (e) {
        console.warn('Error clearing local hand display', e);
      }
      // update final scores
      (scores || []).forEach((s) => {
        const li = root.querySelector('.player[data-player-id="' + s.id + '"]');
        if (li) {
          let scoreNode = li.querySelector('.player-score');
          if (!scoreNode) {
            scoreNode = document.createElement('span');
            scoreNode.className = 'player-score small muted';
            li.querySelector('.player-name').appendChild(scoreNode);
          }
          scoreNode.textContent = s.score;
        }
      });

      // show discard counts if provided
      if (typeof whiteDiscardCount !== 'undefined') root.dataset.whiteDiscardCount = String(whiteDiscardCount);
      if (typeof blackDiscardCount !== 'undefined') root.dataset.blackDiscardCount = String(blackDiscardCount);

      // show a winner splash if we have a winning name
      if (winnerName) {
        showWinnerSplash(winnerName, scores || []);
      }
    });

    // helper: show a persistent winner splash modal with final scores
    function showWinnerSplash(winnerName, scores) {
      // ensure we don't create duplicates
      if (document.getElementById('winner-splash')) return;
      const overlay = document.createElement('div');
      overlay.id = 'winner-splash';
      overlay.className = 'winner-splash';
      overlay.innerHTML = `<div class="winner-splash__panel panel"><h2>Winner: ${escapeHtml(
        winnerName || 'Player'
      )}</h2><div class="winner-splash__scores">${(scores || [])
        .map((s) => `<div class="score-line"><strong>${escapeHtml(s.name || 'Player')}</strong> — ${s.score}</div>`)
        .join(
          ''
        )}</div><div class="winner-splash__actions"><button id="returnToLobbyBtn" class="btn btn-ghost">Return to Lobby</button><button class="btn btn-primary" id="closeWinnerSplash">Close</button></div></div>`;
      document.body.appendChild(overlay);
      document.getElementById('closeWinnerSplash').onclick = () => overlay.remove();

      // wire the return-to-lobby button to leave the room first, then navigate
      const returnToLobbyBtn = document.getElementById('returnToLobbyBtn');
      if (returnToLobbyBtn) {
        returnToLobbyBtn.onclick = leaveRoom;
      }
    }

    // Judge changed — highlight judge in player list
    socket.on('judgeChanged', function ({ judgeId } = {}) {
      const root = document.querySelector('.room');
      if (!root) return;
      const strJudge = String(judgeId || '');
      root.dataset.currentJudge = strJudge;
      // ensure we compare as strings and update role labels immediately
      document.querySelectorAll('.player').forEach((el) => {
        const pid = String(el.dataset.playerId || '');
        const isJudge = pid === strJudge;
        el.classList.toggle('player-judge', isJudge);
        const roleNode = el.querySelector('.player-role');
        if (roleNode) roleNode.textContent = isJudge ? 'Card Czar' : '';
      });
      // re-render hand buttons to disable/enable playing depending on judge
      enableLocalReadyButton();
    });

    // When the room is disbanded (creator left), navigate back to lobby
    socket.on('roomDisbanded', function ({ roomId, reason } = {}) {
      try {
        showToast('Room has been disbanded: ' + (reason || 'creator left'), { type: 'warning' });
        // clear local session and redirect to lobby
        try {
          sessionStorage.removeItem('playerId');
        } catch (e) {}
        setTimeout(() => (window.location.href = '/'), 600);
      } catch (e) {
        console.error('Error handling roomDisbanded', e);
      }
    });

    // Start game handler for creator — open confirmation dialog first
    function startGameHandler(e) {
      const btn = e.currentTarget;
      const dialog = document.getElementById('start-confirm');
      if (!dialog) {
        // fallback: no dialog available, proceed immediately
        startGameConfirm(btn);
        return;
      }

      // remove any residual listeners to avoid duplicates
      const cancelBtn = dialog.querySelector('[data-action="cancel-start"]');
      const confirmBtn = document.getElementById('confirmStartBtn');

      function cancelStart() {
        dialog.close();
      }
      function confirmStart() {
        dialog.close();
        startGameConfirm(btn);
      }

      // clean up previous handlers
      cancelBtn && cancelBtn.removeEventListener('click', cancelStart);
      confirmBtn && confirmBtn.removeEventListener('click', confirmStart);

      // attach and show
      cancelBtn && cancelBtn.addEventListener('click', cancelStart);
      confirmBtn && confirmBtn.addEventListener('click', confirmStart);
      dialog.showModal();

      // show a small waiting hint in the hand area while server deals
      const root = document.querySelector('.room');
      if (root) {
        const handCol = root.querySelector('.hand-column');
        if (handCol && !handCol.querySelector('.hand-status')) {
          const status = document.createElement('div');
          status.className = 'hand-status small muted';
          status.textContent = 'Waiting for hand...';
          try {
            handCol.insertBefore(status, handCol.querySelector('.player-hand'));
          } catch (e) {}
        }
      }
    }

    // perform the confirmed start request to server
    function startGameConfirm(btn) {
      const myId = sessionStorage.getItem('playerId');
      const roomId = window.location.pathname.split('/')[1];
      if (!myId || !roomId) return;
      if (btn) {
        btn.disabled = true;
        btn.classList.add('pending');
      }
      app.socket.timeout(5000).emit('startGame', { roomId, playerId: myId }, (err, resp) => {
        if (btn) {
          btn.classList.remove('pending');
        }
        if (err) {
          showToast('Failed to start game: ' + (err && err.error ? err.error : 'timeout'), {
            type: 'error',
            actionLabel: 'Retry',
            action: () => {
              // reopen dialog to let creator retry
              const dialog = document.getElementById('start-confirm');
              if (dialog) dialog.showModal();
            },
          });
          if (btn) {
            btn.disabled = false;
          }
        } else {
          // server will emit gameStarted to all clients — avoid duplicate local toast here
          if (btn) {
            btn.disabled = true;
          }
          const dialog = document.getElementById('start-confirm');
          if (dialog && dialog.open) {
            dialog.close();
          }
          // server will emit gameStarted to all clients
        }
      });
    }

    // register the socket for this room so server can broadcast
    const sessionPlayerId = sessionStorage.getItem('playerId');
    const roomId = window.location.pathname.split('/')[1];
    if (sessionPlayerId && roomId) {
      socket.emit('register', { roomId, playerId: sessionPlayerId });
    }
  }

  // helper for external updates (e.g. sockets)
  window.roomUI = window.roomUI || {};
  window.roomUI.setPlayerReady = function (playerId, ready) {
    const btn = document.querySelector('.btn-ready[data-player-id="' + playerId + '"]');
    if (!btn) return;
    const li = btn.closest('.player');
    const indicator = li.querySelector('.player-indicator');

    // clear pending state if present
    btn.classList.remove('pending');

    if (ready) {
      li.classList.add('player-ready');
      btn.textContent = 'Unready';
      if (indicator) {
        indicator.classList.add('ready');
        indicator.title = 'Ready';
      }
    } else {
      li.classList.remove('player-ready');
      btn.textContent = 'Ready';
      if (indicator) {
        indicator.classList.remove('ready');
        indicator.title = 'Not ready';
      }
    }

    // enable/disable buttons correctly: only enable the local player's button
    const myId = sessionStorage.getItem('playerId');
    if (btn.dataset.playerId === myId) {
      btn.disabled = false;
      btn.classList.remove('disabled');
    } else {
      btn.disabled = true;
      btn.classList.add('disabled');
    }
  };

  enableLocalReadyButton();
}
