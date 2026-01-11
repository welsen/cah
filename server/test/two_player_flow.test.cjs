import Room from '../utils/room.mjs';
import Player from '../utils/player.mjs';

describe('Two-player game flow', () => {
  test('auto-submission + judgePick flow does not award points prematurely', async () => {
    const room = new Room('test', 2);
    const p1 = new Player('Alice');
    const p2 = new Player('Bob');

    // Add players; p1 will be at index 0
    room.addPlayer(p1);
    room.addPlayer(p2);

    // set creator for determinism
    room.creatorId = p1.id;

    // start the game
    room.startGame();

    const game = room.game;
    expect(game.gameState).toBeDefined();

    // after deal, on two-player games performTwoPlayerAutoSubmit should have created one anonymous submission
    const submissionsAfterDeal = Array.from(game.submissions.values());
    expect(submissionsAfterDeal.length).toBeGreaterThanOrEqual(1);

    // find judge and non-judge
    const judge = game.currentJudge;
    const nonJudge = Array.from(room.players.values()).find(p => p.id !== judge.id);
    expect(judge).toBeDefined();
    expect(nonJudge).toBeDefined();

    // ensure no points awarded yet
    expect(p1.score).toBe(0);
    expect(p2.score).toBe(0);

    // have the non-judge submit a card from their hand
    const handCard = nonJudge.hand[0];
    expect(handCard).toBeDefined();
    const res = room.playCard(nonJudge.id, handCard.id);
    expect(res && res.ok).toBe(true);

    // verify that no points were awarded immediately after submit
    expect(p1.score).toBe(0);
    expect(p2.score).toBe(0);

    // find the submission that belongs to the non-judge
    const submissionList = Array.from(game.submissions.values());
    const nonAuto = submissionList.find(s => s.playerId === nonJudge.id);
    expect(nonAuto).toBeDefined();

    // judge must call judgePick to award
    const judgeRes = room.judgePick(judge.id, nonAuto.id);
    expect(judgeRes && judgeRes.ok).toBe(true);

    // now the non-judge should have been awarded a point
    expect(nonJudge.score).toBe(1);
  });

  test('judge cannot play a card', async () => {
    const room = new Room('test2', 2);
    const a = new Player('A');
    const b = new Player('B');
    room.addPlayer(a);
    room.addPlayer(b);
    room.startGame();
    const game = room.game;
    const judge = game.currentJudge;
    const judgePlayer = room.players.get(judge.id);
    const other = Array.from(room.players.values()).find(p => p.id !== judge.id);

    // judge tries to play
    let threw = false;
    try {
      room.playCard(judge.id, (judgePlayer.hand[0] && judgePlayer.hand[0].id) || 'nope');
    } catch (e) {
      threw = true;
      expect(e.message).toBe('judge_cannot_play');
    }
    expect(threw).toBe(true);
  });
});