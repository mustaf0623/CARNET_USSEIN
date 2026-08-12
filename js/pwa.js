// pwa.js — Installation de la PWA (bouton flottant, prompt natif, guide iOS)
// et enregistrement/mise à jour du Service Worker.
import { showToast } from './state.js';
import { ICONS } from './config.js';

let deferredInstallPrompt = null;
const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;
const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;

function showInstallBtn() {
  if (isStandalone) return;
  const btn = document.getElementById('installBtn');
  if (btn) btn.style.display = 'inline-flex';
}
function hideInstallBtn() {
  const btn = document.getElementById('installBtn');
  if (btn) btn.style.display = 'none';
}

function renderIOSInstallModal() {
  return `
  <div class="onboard-overlay" id="iosInstallOverlay">
    <div class="onboard-card">
      <div class="onboard-mark">${ICONS.mark}</div>
      <h2>Installer Carnet</h2>
      <p>Appuyez sur l’icône <strong>Partager</strong> en bas de Safari (le carré avec une flèche), puis sur <strong>« Sur l’écran d’accueil »</strong>.</p>
      <button class="btn btn-primary" id="iosInstallCloseBtn" style="width:100%;justify-content:center;">Compris</button>
    </div>
  </div>`;
}
function attachIOSInstallModal() {
  document.getElementById('iosInstallCloseBtn').addEventListener('click', () => {
    document.getElementById('iosInstallOverlay').remove();
  });
}

// À appeler une fois au démarrage (main.js) : câble les écouteurs globaux
// liés à l'installation PWA (bouton flottant #installBtn).
export function initInstallPrompt() {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    showInstallBtn();
  });
  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    hideInstallBtn();
    showToast('Application installée ✓');
  });

  document.getElementById('installBtn').addEventListener('click', async () => {
    if (deferredInstallPrompt) {
      deferredInstallPrompt.prompt();
      const choice = await deferredInstallPrompt.userChoice;
      deferredInstallPrompt = null;
      hideInstallBtn();
      if (choice.outcome !== 'accepted') showInstallBtn();
    } else if (isIOS) {
      document.getElementById('app').insertAdjacentHTML('afterend', renderIOSInstallModal());
      attachIOSInstallModal();
    }
  });

  if (isIOS && !isStandalone) showInstallBtn();
}

// À appeler une fois au démarrage : enregistre le Service Worker et affiche
// une bannière lorsqu'une nouvelle version est disponible.
export function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', async () => {
    try {
      const registration = await navigator.serviceWorker.register('./sw.js');
      const notifyUpdate = () => {
        if (document.getElementById('swUpdateBanner')) return;
        const banner = document.createElement('div');
        banner.id = 'swUpdateBanner';
        banner.style.cssText = 'position:fixed;left:50%;bottom:22px;transform:translateX(-50%);z-index:9999;background:var(--ink);color:var(--paper);padding:11px 12px 11px 16px;border-radius:999px;display:flex;align-items:center;gap:10px;font-size:12.5px;font-weight:600;box-shadow:0 8px 24px rgba(0,0,0,0.25);';
        banner.innerHTML = '<span>Nouvelle version disponible</span><button id="swUpdateReloadBtn" style="background:var(--paper);color:var(--ink);border:none;border-radius:999px;padding:6px 13px;font-weight:700;cursor:pointer;font-size:12.5px;">Recharger</button>';
        document.body.appendChild(banner);
        document.getElementById('swUpdateReloadBtn').addEventListener('click', () => window.location.reload());
      };
      registration.addEventListener('updatefound', () => {
        const newWorker = registration.installing;
        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            notifyUpdate();
          }
        });
      });
      // Mobile ne revérifie pas toujours spontanément le sw.js : on force la
      // vérification à chaque retour au premier plan, et périodiquement.
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden) registration.update().catch(() => {});
      });
      setInterval(() => registration.update().catch(() => {}), 60 * 60 * 1000);
    } catch (err) { /* pas grave hors ligne au premier chargement */ }
  });
}
