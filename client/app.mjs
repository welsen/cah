import hb from 'https://cdn.jsdelivr.net/npm/handlebars@4.7.8/+esm';
import socketIoClient from 'https://cdn.jsdelivr.net/npm/socket.io-client@4.8.3/+esm';
import Router from './utils/router.mjs';
import { createConnectionBadge, initBadgeListeners } from './templates/connection-badge/connection-badge.mjs';
import { render, update } from './utils/render.mjs';
import cardPacks from '/api/cardPacks' with { type: 'json' };

class App {
  static instance = null;

  router;
  appWrapper;
  socket;
  socketId;

  constructor(routes = {}) {
    if (App.instance) {
      return App.instance;
    }
    App.instance = this;
    this.appWrapper = document.querySelector('app');
    this.router = new Router({ type: 'history', routes }).listen().on('route', this.onRouteChange.bind(this));
    this.socket = socketIoClient();
    this.socketId = this.socket.id;

    // Debug helpers: expose socket and provide connection lifecycle logs
    window.appSocket = this.socket;

    // add a small connection badge to the page for quick visibility
    createConnectionBadge()
      .then(() => {
        console.info('[socket] connection badge created');
        initBadgeListeners();
      })
      .catch((e) => {
        console.error('Failed to create connection badge', e);
      });

    this.socket.on('message', (m) => {
      console.debug('[socket] message', m);
    });
    this.socket.onAny((ev, ...args) => {
      console.debug('[socket] event', ev, args);
    });

    // Lobby updates: auto-populate rooms list when socket receives lobbyRooms
    this.socket.on('lobbyRooms', async (rooms) => {
      console.debug('[socket] lobbyRooms', rooms);
      try {
        // only render if we are on the main lobby (no room id in path)
        const roomId = window.location.pathname.split('/')[1];
        if (roomId) return;
        
        // fetch the lobby template and re-render with the new rooms
        if (!this.lobbyRendered) {
          await render(this.appWrapper, './templates/lobby/index.html', { rooms, cardPacks });
        } else {
          await update(this.appWrapper, './templates/lobby/index.html', { rooms, cardPacks });
        }
        // initialize lobby module if available
        try {
          const lobbyModule = await import('./templates/lobby/lobby.mjs');
          if (lobbyModule && typeof lobbyModule.initLobby === 'function') {
            lobbyModule.initLobby(this);
          }
        } catch (e) {
          console.error('Failed to initialize lobby module after lobbyRooms', e);
        }
      } catch (e) {
        console.error('Error handling lobbyRooms', e);
      }
      this.lobbyRendered = true;
    });
  }

  static getInstance(routes = {}) {
    if (!App.instance) {
      App.instance = new App(routes);
    }
    if (!document.app) document.app = App.instance;

    return App.instance;
  }

  submitJoinRoomForm(event) {
    const form = event.target;
    const roomId = form.roomId.value;
    const username = form.username.value;
    console.log(event, `Joining room ${roomId} as ${username}`);
    // Add your join room logic here
    fetch(`/api/rooms/${roomId}/join`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        username: username,
        playerId: sessionStorage.getItem('playerId'),
        password: form.password?.value || null,
      }),
    })
      .then((response) => {
        if (response.ok) {
          return response.json().then((data) => {
            sessionStorage.setItem('playerId', data.playerId);
            sessionStorage.setItem('roomId', roomId);
            // register this socket for the room so the server can send realtime updates
            if (this.socket && data.playerId) {
              this.socket.emit('register', { roomId, playerId: data.playerId });
            }
            this.router.navigateTo(`/${roomId}`);
          });
        } else {
          throw new Error('Failed to join room');
        }
      })
      .catch((error) => {
        console.error('Error joining room:', error);
        // re-enable join form submit in case of failure
        const joinDialog = document.getElementById('joinDialog');
        const submit = joinDialog?.querySelector('button[type="submit"]');
        if (submit) {
          submit.disabled = false;
          submit.classList.remove('disabled');
        }
      });
  }

  createRoom(event) {
    const form = event.target;
    const username = form.username.value;
    const roomName = form.roomName.value;
    const maxPlayers = form.maxPlayers.value;
    const maxScore = form.maxScore.value;
    const selectedCardPacks = Array.from(form.cardPacks)
      .filter((cb) => cb.checked)
      .map((cb) => cb.value);
    // Add your create room logic here
    fetch('/api/rooms', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: roomName,
        maxPlayers: parseInt(maxPlayers, 10),
        password: form.password?.value || null,
        creatorName: username,
        maxScore: parseInt(maxScore, 10),
        cardPacks: selectedCardPacks,
      }),
    })
      .then((response) => response.json())
      .then((data) => {
        if (data.roomId) {
          this.submitJoinRoomForm({
            target: {
              username: { value: username },
              roomId: { value: data.roomId },
              password: { value: form.password?.value || null },
            },
          });
        }
      })
      .catch((error) => {
        console.error('Error creating room:', error);
        const createDialog = document.getElementById('createDialog');
        const submit = createDialog?.querySelector('button[type="submit"]');
        if (submit) {
          submit.disabled = false;
          submit.classList.remove('disabled');
        }
      });
  }

  onRouteChange(route, params) {
    const roomId = window.location.pathname.split('/')[1];
    if (!roomId) {
      const sessionRoomId = sessionStorage.getItem('roomId');
      if (sessionRoomId) {
        this.router.navigateTo(`/${sessionRoomId}`);
      } else {
        fetch('/api/rooms')
          .then((response) => {
            if (response.ok) {
              return response.json();
            } else {
              throw new Error('Failed to fetch rooms');
            }
          })
          .then(async (data) => {
            await render(this.appWrapper,'./templates/lobby/index.html',{ rooms: data.rooms, cardPacks });
            // initialize lobby module if available
            try {
              const lobbyModule = await import('./templates/lobby/lobby.mjs');
              if (lobbyModule && typeof lobbyModule.initLobby === 'function') {
                lobbyModule.initLobby(this);
              }
            } catch (e) {
              console.error('Failed to initialize lobby module', e);
            }
          })
          .catch((error) => {
            console.error('Error fetching rooms:', error);
          });
      }
    } else {
      this.appWrapper.innerHTML = `<p>Loading room details for "${roomId}"...</p>`;
      fetch(`/api/rooms/${roomId}`)
        .then((response) => {
          if (response.ok) {
            return response.json();
          } else {
            sessionStorage.removeItem('roomId');
            this.router.navigateTo('/');
            throw new Error('Room not found');
          }
        })
        .then(async (room) => {
          await render(this.appWrapper, './templates/room/index.html', room);

          // initialize room UI module (if present) after rendering
          try {
            const roomModule = await import('./templates/room/room.mjs');
            if (roomModule && typeof roomModule.initRoom === 'function') {
              roomModule.initRoom(this);
            }
          } catch (e) {
            console.error('Failed to initialize room module', e);
          }
        })
        .catch((error) => {
          console.error('Error fetching room details:', error);
          this.appWrapper.innerHTML = `<p>${error.message}</p>`;
        });
    }
  }
}

export default App;
