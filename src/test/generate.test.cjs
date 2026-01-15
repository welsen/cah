describe('ID Generators', () => {
  test('generated room ids are correctly formatted and unique', async () => {
    const { generateHashedRoomId } = await import('../utils/generateHashedRoomId.mjs');
    const COUNT = parseInt(process.env.COUNT, 10) || 10000;
    const format = /^[a-z]{3}-[a-z]{4}-[a-z]{3,}$/;

    const seen = new Set();
    for (let i = 0; i < COUNT; i++) {
      const id = generateHashedRoomId();
      expect(format.test(id)).toBe(true);
      expect(seen.has(id)).toBe(false);
      seen.add(id);
    }
  });
  test('generated player ids are correctly formatted and unique', async () => {
    const { generateHashedPlayerId } = await import('../utils/generateHashedPlayerId.mjs');
    const COUNT = parseInt(process.env.COUNT, 10) || 10000;
    const format = /^u[a-z]{7}-[a-z]{3,}$/;

    const seen = new Set();
    for (let i = 0; i < COUNT; i++) {
      const id = generateHashedPlayerId();
      expect(format.test(id)).toBe(true);
      expect(seen.has(id)).toBe(false);
      seen.add(id);
    }
  });
});
