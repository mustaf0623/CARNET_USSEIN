// auth.js — Écran de connexion / inscription Supabase.
// Remplace entièrement #app le temps de l'authentification (comme l'original) ;
// n'a pas besoin de passer par le routeur d'onglets classique.

import { AppState } from './state.js';
import { ICONS, escapeHtml } from './config.js';
import { startApp } from './db/sync.js';

let authMode = 'login'; // 'login' | 'signup'

export function renderAuthScreen(errorMsg) {
  const canGoBack = !!(AppState.data && (AppState.data.programmes.length || AppState.data.membres.length || AppState.data.sessions.length));
  document.getElementById('app').innerHTML = `
  <div class="onboard-overlay" style="position:fixed;">
    <div class="onboard-card" style="position:relative;">
      ${canGoBack ? `<button id="authBackBtn" title="Retour à l’app" style="position:absolute;top:14px;right:14px;width:30px;height:30px;border-radius:50%;border:1px solid var(--line);background:var(--card-2);color:var(--ink-dim);font-size:16px;line-height:1;cursor:pointer;">×</button>` : ''}
      <div class="onboard-mark">${ICONS.mark}</div>
      <h2>${authMode === 'login' ? 'Se connecter' : 'Créer un compte'}</h2>
      <p>Connectez-vous pour retrouver les mêmes données sur tous vos appareils.</p>
      ${errorMsg ? `<p style="color:var(--terracotta);font-size:12.5px;margin-top:-10px;">${escapeHtml(errorMsg)}</p>` : ''}
      <input type="text" id="authEmail" placeholder="Adresse e-mail" autocomplete="username" style="margin-bottom:10px;" />
      <input type="password" id="authPassword" placeholder="Mot de passe" autocomplete="current-password" />
      <button class="btn btn-primary" id="authSubmitBtn" style="width:100%;justify-content:center;margin-top:14px;margin-bottom:10px;">${authMode === 'login' ? 'Se connecter' : 'Créer le compte'}</button>
      <button class="btn btn-ghost" id="authToggleBtn" style="width:100%;justify-content:center;">${authMode === 'login' ? 'Pas encore de compte ? En créer un' : 'Déjà un compte ? Se connecter'}</button>
      ${canGoBack ? `<button class="btn btn-ghost" id="authBackBtn2" style="width:100%;justify-content:center;margin-top:6px;color:var(--ink-faint);">Continuer sans se connecter</button>` : ''}
    </div>
  </div>`;
  document.getElementById('authSubmitBtn').addEventListener('click', submitAuth);
  document.getElementById('authPassword').addEventListener('keydown', e => { if (e.key === 'Enter') submitAuth(); });
  document.getElementById('authToggleBtn').addEventListener('click', () => { authMode = authMode === 'login' ? 'signup' : 'login'; renderAuthScreen(); });
  if (canGoBack) {
    document.getElementById('authBackBtn').addEventListener('click', AppState.render);
    document.getElementById('authBackBtn2').addEventListener('click', AppState.render);
  }
}

async function submitAuth() {
  const sb = AppState.sb;
  const email = document.getElementById('authEmail').value.trim();
  const password = document.getElementById('authPassword').value;
  if (!email || !password) { renderAuthScreen('Merci de renseigner un e-mail et un mot de passe.'); return; }
  const btn = document.getElementById('authSubmitBtn');
  btn.disabled = true; btn.textContent = 'Un instant…';
  try {
    // On indique explicitement où revenir après confirmation de l'e-mail :
    // sans ça, Supabase utilise l'URL par défaut configurée dans son
    // tableau de bord (souvent restée sur un localhost de développement),
    // ce qui casse le lien reçu par e-mail sur tout autre appareil.
    const redirectTo = window.location.origin + window.location.pathname;
    const fn = authMode === 'login'
      ? () => sb.auth.signInWithPassword({ email, password })
      : () => sb.auth.signUp({ email, password, options: { emailRedirectTo: redirectTo } });
    const { data, error } = await fn();
    if (error) { renderAuthScreen(error.message); return; }
    if (authMode === 'signup' && !data.session) {
      renderAuthScreen('Compte créé — vérifiez votre e-mail pour confirmer, puis connectez-vous.');
      authMode = 'login';
      return;
    }
    AppState.sbUser = data.user;
    await startApp(AppState.data);
  } catch (e) {
    renderAuthScreen('Connexion impossible. Vérifiez votre réseau et réessayez.');
  } finally {
    btn.disabled = false; btn.textContent = authMode === 'login' ? 'Se connecter' : 'Créer le compte';
  }
}
