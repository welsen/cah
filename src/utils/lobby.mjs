import EventEmitter from 'events';

class Lobby extends EventEmitter {
  constructor(maxSize = 100) {
    super();
    this.rooms = new Map();
    this.maxSize = maxSize; // maximum number of rooms allowed in the lobby
  }

  getRoom(roomId) {
    return this.rooms.get(roomId);
  }

  addRoom(room) {
    if (this.rooms.size >= this.maxSize) {
      throw new Error('Lobby is full');
    }
    // prevent duplicate room names (case-insensitive)
    const name = (room.name || '').toString().trim().toLowerCase();
    if (name) {
      const existing = Array.from(this.rooms.values()).find((r) => (r.name || '').toLowerCase() === name);
      if (existing) {
        throw new Error('Room already exists');
      }
    }
    this.rooms.set(room.id, room);
    // notify listeners that a room was added
    console.debug('[lobby] room added', { id: room.id, name: room.name });
    this.emit('roomAdded', room);
  }

  removeRoom(roomId) {
    this.rooms.delete(roomId);
    // notify listeners that a room was removed
    this.emit('roomRemoved', roomId);
  }
}

export default Lobby;
