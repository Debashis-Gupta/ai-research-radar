// Chrome owns the install prompt. Show our button only when installation is available.
(() => {
  const button = document.querySelector('#installApp');
  let promptEvent;
  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    if (window.matchMedia('(display-mode: standalone)').matches) return;
    promptEvent = event;
    button.classList.remove('hidden');
  });
  button.addEventListener('click', async () => {
    if (!promptEvent) return;
    const event = promptEvent;
    promptEvent = null;
    button.disabled = true;
    try { await event.prompt(); await event.userChoice; }
    catch (error) { console.error('App installation prompt failed', error); }
    finally { button.disabled = false; button.classList.add('hidden'); }
  });
  window.addEventListener('appinstalled', () => {
    promptEvent = null;
    button.classList.add('hidden');
  });
})();
