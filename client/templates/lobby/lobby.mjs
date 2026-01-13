// Lobby UI module: initializes join/create dialog behaviors and room join buttons

export function initLobby(app) {
  const root = document.querySelector('.lobby');
  if (!root) return;

  const joinDialog = root.querySelector('#joinDialog');
  const createDialog = root.querySelector('#createDialog');
  const roomIdInput = root.querySelector('#roomIdInput');

  // Clean previous listeners (idempotent) - use data-action hooks
  root.querySelectorAll('[data-action="show-modal"]').forEach((button) => {
    button.removeEventListener('click', onShowModalClick);
  });
  root.querySelectorAll('[data-action="close"]').forEach((button) => {
    button.removeEventListener('click', onDialogClose);
  });
  root.querySelectorAll('.dialog-cancel').forEach((button) => {
    button.removeEventListener('click', onDialogCancel);
  });

  function onShowModalClick(e) {
    const el = e.currentTarget;
    const targetId = el.dataset.target;
    const action = el.dataset.action;
    if (action !== 'show-modal') return;
    if (targetId && roomIdInput && el.dataset.roomId) {
      roomIdInput.value = el.dataset.roomId;
    }
    const dialog = root.querySelector(`#${targetId}`);
    if (dialog && typeof dialog.showModal === 'function') {
      dialog.showModal();
      // focus the first input inside the dialog if present
      setTimeout(() => dialog.querySelector('input')?.focus(), 20);
    }
  }

  function onDialogCancel(e) {
    const dialog = e.currentTarget.closest('dialog');
    if (dialog) dialog.close();
  }

  function onDialogClose(e) {
    const el = e.currentTarget;
    const targetId = el.dataset.target;
    if (targetId) {
      const dialog = root.querySelector(`#${targetId}`);
      if (dialog) return dialog.close();
    }
    onDialogCancel(e);
  }

  // form submit handlers
  function onSubmitJoin(e) {
    e.preventDefault();
    const submit = e.target.querySelector('button[type="submit"]');
    if (submit) {
      submit.disabled = true;
      submit.classList.add('disabled');
    }
    if (app && typeof app.submitJoinRoomForm === 'function') {
      app.submitJoinRoomForm(e);
      if (joinDialog) joinDialog.close();
    }
  }

  function onSubmitCreate(e) {
    e.preventDefault();
    const submit = e.target.querySelector('button[type="submit"]');
    if (submit) {
      submit.disabled = true;
      submit.classList.add('disabled');
    }
    if (app && typeof app.createRoom === 'function') {
      app.createRoom(e);
      if (createDialog) createDialog.close();
    }
  }

  // Attach listeners using data-action hooks
  root.querySelectorAll('[data-action="show-modal"]').forEach((button) => {
    button.addEventListener('click', onShowModalClick);
  });
  root.querySelectorAll('[data-action="close"]').forEach((button) => {
    button.addEventListener('click', onDialogClose);
  });
  root.querySelectorAll('.dialog-cancel').forEach((button) => {
    button.addEventListener('click', onDialogCancel);
  });

  // form submit handlers (unobtrusive)
  const joinForm = root.querySelector('form[data-action="submit-join"]');
  if (joinForm) {
    joinForm.removeEventListener('submit', onSubmitJoin);
    joinForm.addEventListener('submit', onSubmitJoin);
  }
  const createForm = root.querySelector('form[data-action="submit-create"]');
  if (createForm) {
    createForm.removeEventListener('submit', onSubmitCreate);
    createForm.addEventListener('submit', onSubmitCreate);
  }

  root.querySelectorAll('[data-action="close"]').forEach((button) => {
    button.addEventListener('click', onDialogClose);
  });

  root.querySelectorAll('.dialog-cancel').forEach((button) => {
    button.addEventListener('click', onDialogCancel);
  });
}
