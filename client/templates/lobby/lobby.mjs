// Lobby UI module: initializes join/create dialog behaviors and room join buttons

function initLobby() {
  const root = document.querySelector('.lobby');
  if (!root) return;

  const joinDialog = document.getElementById('joinDialog');
  const createDialog = document.getElementById('createDialog');
  const roomIdInput = document.getElementById('roomIdInput');

  // Clean previous listeners (idempotent) - use data-action hooks
  document.querySelectorAll('[data-action="show-modal"]').forEach((b) => {
    b.removeEventListener('click', onShowModalClick);
  });
  document.querySelectorAll('[data-action="close"]').forEach((b) => {
    b.removeEventListener('click', onDialogClose);
  });
  document.querySelectorAll('.dialog-cancel').forEach((b) => {
    b.removeEventListener('click', onDialogCancel);
  });

  function onShowModalClick(e) {
    const el = e.currentTarget;
    const targetId = el.dataset.target;
    const action = el.dataset.action;
    if (action !== 'show-modal') return;
    if (targetId && roomIdInput && el.dataset.roomId) {
      roomIdInput.value = el.dataset.roomId;
    }
    const dlg = document.getElementById(targetId);
    if (dlg && typeof dlg.showModal === 'function') {
      dlg.showModal();
      // focus the first input inside the dialog if present
      setTimeout(() => dlg.querySelector('input')?.focus(), 20);
    }
  }

  function onDialogClose(e) {
    const el = e.currentTarget;
    const targetId = el.dataset.target;
    if (targetId) {
      const dlg = document.getElementById(targetId);
      if (dlg) return dlg.close();
    }
    const dlg = el.closest('dialog');
    if (dlg) dlg.close();
  }

  function onDialogCancel(e) {
    // find parent dialog and close it
    const dlg = e.currentTarget.closest('dialog');
    if (dlg) dlg.close();
  }

  // form submit handlers
  function onSubmitJoin(e) {
    e.preventDefault();
    const submit = e.target.querySelector('button[type="submit"]');
    if (submit) {
      submit.disabled = true;
      submit.classList.add('disabled');
    }
    if (document.app && typeof document.app.submitJoinRoomForm === 'function') {
      document.app.submitJoinRoomForm(e);
      const dlg = document.getElementById('joinDialog');
      if (dlg) dlg.close();
    }
  }

  function onSubmitCreate(e) {
    e.preventDefault();
    const submit = e.target.querySelector('button[type="submit"]');
    if (submit) {
      submit.disabled = true;
      submit.classList.add('disabled');
    }
    if (document.app && typeof document.app.createRoom === 'function') {
      document.app.createRoom(e);
      const dlg = document.getElementById('createDialog');
      if (dlg) dlg.close();
    }
  }

  // Attach listeners using data-action hooks
  document.querySelectorAll('[data-action="show-modal"]').forEach((b) => {
    b.addEventListener('click', onShowModalClick);
  });
  document.querySelectorAll('[data-action="close"]').forEach((b) => {
    b.addEventListener('click', onDialogClose);
  });
  document.querySelectorAll('.dialog-cancel').forEach((b) => {
    b.addEventListener('click', onDialogCancel);
  });

  // form submit handlers (unobtrusive)
  const joinForm = document.querySelector('form[data-action="submit-join"]');
  if (joinForm) {
    joinForm.removeEventListener('submit', onSubmitJoin);
    joinForm.addEventListener('submit', onSubmitJoin);
  }
  const createForm = document.querySelector('form[data-action="submit-create"]');
  if (createForm) {
    createForm.removeEventListener('submit', onSubmitCreate);
    createForm.addEventListener('submit', onSubmitCreate);
  }

  document.querySelectorAll('[data-action="close"]').forEach((b) => {
    b.addEventListener('click', onDialogClose);
  });

  document.querySelectorAll('.dialog-cancel').forEach((b) => {
    b.addEventListener('click', onDialogCancel);
  });

  // legacy create button handling still works via data-action
}

// auto-run in case the template is already present
(function boot() {
  if (document.querySelector('.lobby')) initLobby();
  else
    window.addEventListener(
      'DOMContentLoaded',
      () => {
        if (document.querySelector('.lobby')) initLobby();
      },
      { once: true }
    );
})();

export { initLobby };
