import express from 'express';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import App from './app.mjs';
import ApiController from './controllers/api.controller.mjs';
import { bindRoomBroadcasts } from './utils/bindRoomBroadcasts.mjs';
import { getLobbyRooms } from './utils/getLobbyRooms.mjs';

const appInstance = App.getInstance();

// Temporary diagnostic handlers to capture any uncaught errors during runtime
process.on('uncaughtException', (err) => {
  console.error('UNCAUGHT EXCEPTION', err && err.stack ? err.stack : err);
});
process.on('unhandledRejection', (reason) => {
  console.error('UNHANDLED REJECTION', reason && reason.stack ? reason.stack : reason);
});

const server = express();
const httpServer = createServer(server);
const io = new Server(httpServer);
const PORT = process.env.PORT || 3000;

// expose io to the app instance so it can broadcast lobby events
appInstance.io = io;

// bind existing rooms
for (const room of appInstance.lobby.rooms.values()) bindRoomBroadcasts(appInstance, room, io);
// bind future rooms
appInstance.lobby.on('roomAdded', (room) => {
  bindRoomBroadcasts(appInstance, room, io);
  // broadcast updated lobby rooms to all clients
  io.emit('lobbyRooms', getLobbyRooms(appInstance));
});
appInstance.lobby.on('roomRemoved', (roomId) => {
  io.emit('lobbyRooms', getLobbyRooms(appInstance));
});

io.on('connection', (socket) => {
  appInstance.handleConnection(socket);
  console.log(`New client connected: ${socket.id}`);

  // send current lobby rooms immediately to the connecting socket
  try {
    socket.emit('lobbyRooms', getLobbyRooms(appInstance));
  } catch (e) {
    console.error('Error sending lobbyRooms on connect', e);
  }

  socket.on('disconnect', () => {
    console.log(`Client disconnected: ${socket.id}`);
  });
});

server.use(express.json());
server.use('/', express.static('./client'));
server.use('/:room', express.static('./client'));
server.use('/api', ApiController);

httpServer.listen(PORT, () => {
  console.log(`Server is listening on port ${PORT}`);
});
