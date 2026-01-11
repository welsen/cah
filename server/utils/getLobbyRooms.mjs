// helper: serialize rooms for client list

export function getLobbyRooms(appInstance) {
  return Array.from(appInstance.lobby.rooms.values()).map((r) => ({
    id: r.id,
    name: r.name,
    playerCount: r.players.size,
    maxPlayers: r.maxPlayers,
  }));
}
