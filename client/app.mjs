import hb from 'https://cdn.jsdelivr.net/npm/handlebars@4.7.8/+esm';
import socketIoClient from 'https://cdn.jsdelivr.net/npm/socket.io-client@4.8.3/+esm';
import Router from './utils/router.mjs';

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

    // Debug helpers: expose socket and provide connection lifecycle logs
    window.appSocket = this.socket;

    // add a small connection badge to the page for quick visibility
    (function createConnectionBadge() {
      try {
        const badge = document.createElement('div');
        badge.id = 'socket-status';
        badge.style.position = 'fixed';
        badge.style.right = '12px';
        badge.style.top = '12px';
        badge.style.zIndex = '9999';
        badge.style.padding = '6px 10px';
        badge.style.borderRadius = '8px';
        badge.style.background = 'rgba(0,0,0,0.6)';
        badge.style.color = '#fff';
        badge.style.fontSize = '12px';
        badge.style.fontWeight = '700';
        badge.textContent = 'Socket: connecting...';
        document.body.appendChild(badge);
      } catch (e) {
        /* ignore when not in DOM context */
      }
    })();

    const updateBadge = (txt, color) => {
      const b = document.getElementById('socket-status');
      if (!b) return;
      b.textContent = 'Socket: ' + txt;
      b.style.background = color;
    };

    this.socket.on('connect', () => {
      this.socketId = this.socket.id;
      console.info('[socket] connected', { id: this.socketId });
      updateBadge('connected', 'rgba(46,204,113,0.9)');
    });
    this.socket.on('disconnect', (reason) => {
      console.warn('[socket] disconnected', reason);
      updateBadge('disconnected', 'rgba(192,57,43,0.9)');
    });
    this.socket.on('connect_error', (err) => {
      console.error('[socket] connect_error', err);
      updateBadge('error', 'rgba(241,196,15,0.95)');
    });
    this.socket.on('reconnect_attempt', (n) => {
      console.info('[socket] reconnect attempt', n);
      updateBadge('reconnecting...', 'rgba(52,152,219,0.9)');
    });
    this.socket.on('message', (m) => {
      console.debug('[socket] message', m);
    });
    this.socket.onAny((ev, ...args) => {
      console.debug('[socket] event', ev, args);
    });

    // Lobby updates: auto-populate rooms list when socket receives lobbyRooms
    this.socket.on('lobbyRooms', (rooms) => {
      console.debug('[socket] lobbyRooms', rooms);
      try {
        // only render if we are on the main lobby (no room id in path)
        const roomId = window.location.pathname.split('/')[1];
        if (roomId) return;

        // fetch the lobby template and re-render with the new rooms
        (async () => {
          const html = await (await fetch('./templates/lobby/index.html')).text();
          const template = hb.compile(html);
          const out = template({ rooms });
          this.appWrapper.innerHTML = out;
          // initialize lobby module if available
          try {
            const lobbyModule = await import('./templates/lobby/lobby.mjs');
            if (lobbyModule && typeof lobbyModule.initLobby === 'function') {
              lobbyModule.initLobby();
            }
          } catch (e) {
            console.error('Failed to initialize lobby module after lobbyRooms', e);
          }
        })();
      } catch (e) {
        console.error('Error handling lobbyRooms', e);
      }
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
            const lobbyTemplate = await (await fetch('./templates/lobby/index.html')).text();
            const template = hb.compile(lobbyTemplate);
            const out = template({ rooms: data.rooms });
            this.appWrapper.innerHTML = out;

            // initialize lobby module if available
            try {
              const lobbyModule = await import('./templates/lobby/lobby.mjs');
              if (lobbyModule && typeof lobbyModule.initLobby === 'function') {
                lobbyModule.initLobby();
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
          const roomTemplate = await (await fetch('./templates/room/index.html')).text();
          const template = hb.compile(roomTemplate);
          const out = template(room);
          this.appWrapper.innerHTML = out;

          // initialize room UI module (if present) after rendering
          try {
            const roomModule = await import('./templates/room/room.mjs');
            if (roomModule && typeof roomModule.initRoom === 'function') {
              roomModule.initRoom();
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
