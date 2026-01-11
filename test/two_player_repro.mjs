import { io } from "socket.io-client";
// use global fetch (Node 18+ provides fetch)

const base = "http://localhost:3000";

async function createRoom(name) {
  const res = await fetch(base + "/api/rooms", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name }),
  });
  return res.json();
}

async function joinRoom(roomId, username) {
  const res = await fetch(base + "/api/rooms/" + roomId + "/join", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username }),
  });
  return res.json();
}

function connect(playerId) {
  const s = io(base, { transports: ["websocket"], reconnection: false });
  s.on("connect", () => console.log("[client] connected", playerId, s.id));
  s.on("disconnect", () => console.log("[client] disconnected", playerId));
  s.onAny((ev, ...args) => {
    console.log("[client]", playerId, "evt", ev, args);
  });
  return s;
}

(async () => {
  try {
    const roomName = "two-player-test-" + Math.random().toString(36).slice(2, 6);
    const create = await createRoom(roomName);
    console.log("room created", create);
    const roomId = create.roomId;

    const p1 = await joinRoom(roomId, "Alice");
    const p2 = await joinRoom(roomId, "Bob");
    console.log("joined", p1, p2);

    const sock1 = connect(p1.playerId);
    const sock2 = connect(p2.playerId);

    // wait for connections
    await new Promise((r) => setTimeout(r, 600));

    sock1.emit("register", { roomId, playerId: p1.playerId });
    sock2.emit("register", { roomId, playerId: p2.playerId });

    // set both ready
    sock1.emit("playerReady", { roomId, playerId: p1.playerId, ready: true });
    sock2.emit("playerReady", { roomId, playerId: p2.playerId, ready: true });

    // wait a moment and have creator start
    setTimeout(() => {
      console.log("Attempting to start game");
      sock1.emit("startGame", { roomId, playerId: p1.playerId }, (ack) => {
        console.log("startGame ack", ack);
      });
    }, 600);

    // after game starts, try to submit a card twice rapidly from player 2
    sock2.on("gameStarted", async () => {
      console.log("[test] gameStarted observed");
      // request hand explicitly in case we missed it
      sock2.timeout(2000).emit("requestHand", { roomId, playerId: p2.playerId }, (err, resp) => {
        if (err) console.warn("requestHand ack err", err);
        else console.debug("requestHand ack", resp);
      });
    });

    // Track autosubmit events and verify autosubmission is taken from deck (i.e., player's hand length doesn't shrink)
    let p1HandLen = null;
    let awaitingAutosubmitCheck = false;
    sock1.on('playerHand', ({ hand }) => {
      if (hand) {
        // if we were awaiting verification, compare lengths
        if (awaitingAutosubmitCheck) {
          if (hand.length === p1HandLen) {
            console.log('[test assert] autosubmit did NOT remove a card from the player hand (OK)', { before: p1HandLen, after: hand.length });
          } else {
            console.error('[test assert] autosubmit unexpectedly changed player hand length', { before: p1HandLen, after: hand.length });
            process.exit(1);
          }
          awaitingAutosubmitCheck = false;
        }
        p1HandLen = hand.length;
      }
    });
    sock1.on('playerSubmitted', ({ playerId, submissionId, auto } = {}) => {
      // anonymous system autosubmits should come as playerId === null and auto === true
      if (playerId === null && auto) {
        console.log('[test] anonymous autosubmission observed', { submissionId });
        // request hand explicitly to verify it's unchanged
        awaitingAutosubmitCheck = true;
        sock1.timeout(2000).emit('requestHand', { roomId, playerId: p1.playerId }, (err, resp) => {
          if (err) {
            console.warn('[test] requestHand after autosubmit failed', err);
            awaitingAutosubmitCheck = false;
          } else {
            console.log('[test] requested hand after autosubmit (resp ok)');
          }
        });
      }
    });

    // track current judge so we only attempt play when this client is not judge
    let currentJudge = null;
    sock2.on("judgeChanged", ({ judgeId } = {}) => {
      currentJudge = judgeId;
      console.log("[test] judgeChanged (tracked)", judgeId);
    });
    // track current black pick for multi-card submissions
    let currentBlackPick = 1;
    sock2.on("blackCard", (card) => {
      currentBlackPick = card && (card.pick || card.pick === 0) ? card.pick : 1;
      console.log("[test] blackCard pick", currentBlackPick);
    });

    // listen for an explicit playerHand and when it arrives attempt a double-submit if not judge
    sock2.on("playerHand", ({ hand }) => {
      console.log(
        "[test] playerHand",
        hand && hand.length,
        "currentJudge=",
        currentJudge,
        "blackPick=",
        currentBlackPick
      );
      if (hand && hand.length) {
        const card = hand[0];
        if (card && card.id) {
          if (String(currentJudge) === String(p2.playerId)) {
            console.log("[test] skipping play: this client is judge");
            return;
          }

          // if blackPick >=2, test multi-card submission by submitting the first N cards
          if (currentBlackPick && currentBlackPick >= 2) {
            const pick = currentBlackPick;
            const ids = hand
              .slice(0, pick)
              .map((c) => c.id)
              .filter(Boolean);
            console.log("[test] multi-submit", ids);
            sock2.timeout(2000).emit("playCard", { roomId, playerId: p2.playerId, cardId: ids }, (err, resp) => {
              console.log("playCard multi ack", err, resp);
            });
            return;
          }

          // otherwise, existing single-card double-submit test
          // attempt double play and capture acks
          console.log("[test] playing card once", card.id);
          const double = { ack1: null, ack2: null };
          sock2.timeout(2000).emit("playCard", { roomId, playerId: p2.playerId, cardId: card.id }, (err, resp) => {
            console.log("playCard ack1", err, resp);
            double.ack1 = err || (resp && resp.error) || null;
          });
          setTimeout(() => {
            console.log("[test] playing card twice", card.id);
            sock2.timeout(2000).emit("playCard", { roomId, playerId: p2.playerId, cardId: card.id }, (err, resp) => {
              console.log("playCard ack2", err, resp);
              double.ack2 = err || (resp && resp.error) || null;
            });
            // check results shortly after the second ack (give time for responses)
            setTimeout(() => {
              const isRejected = (val) =>
                val === "already_submitted" ||
                val === "invalid_selection_count" ||
                (val && typeof val === "object" && (val.error === "already_submitted" || val.error === "invalid_selection_count"));

              const sawRejected = isRejected(double.ack1) || isRejected(double.ack2);
              if (sawRejected) {
                console.log("[test assert] duplicate submit correctly rejected (accepted rejection codes)");
              } else {
                console.error("[test assert] duplicate submit NOT rejected as expected", double);
                process.exit(1);
              }
            }, 250);
          }, 120);
        }
      }
    });

    // Both sockets listen to judgeChanged; if not the judge, request hand and attempt double-play when hand arrives
    [
      { sock: sock1, id: p1.playerId },
      { sock: sock2, id: p2.playerId },
    ].forEach(({ sock, id }) => {
      sock.on("judgeChanged", ({ judgeId } = {}) => {
        console.log("[test] judgeChanged", judgeId, "for", id);
        if (String(judgeId) === String(id)) {
          console.log("[test] this socket is judge — will not play", id);
          return;
        }
        // otherwise request a hand and the playerHand handler will attempt the double play
        sock.timeout(2000).emit("requestHand", { roomId, playerId: id }, (err, resp) => {
          if (err) console.warn("requestHand ack err", err);
          else console.debug("requestHand ack", resp);
        });
      });
    });

    // observe submissionCount events
    sock1.on("submissionCount", ({ count, required }) => {
      console.log("[submissionCount]", count, "/", required);
    });

    // observe submissionsReady at judge sockets
    sock1.on("submissionsReady", (payload) => {
      const list = Array.isArray(payload) ? payload : payload && payload.submissions ? payload.submissions : [];
      console.log("[judge submissionsReady]", list);
    });
    sock2.on("submissionsReady", (payload) => {
      const list = Array.isArray(payload) ? payload : payload && payload.submissions ? payload.submissions : [];
      console.log("[judge submissionsReady - sock2]", list);
    });

    // exit after some time
    setTimeout(() => {
      console.log("Test finished, exiting");
      sock1.close();
      sock2.close();
      process.exit(0);
    }, 7000);
  } catch (e) {
    console.error("Test error", e);
    process.exit(1);
  }
})();
