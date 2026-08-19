// main.js — Point d'entrée de l'application. Orchestre, dans l'ordre :
// 1) le câblage de AppState.render vers le shell (casse le cycle d'import),
// 2) le chargement des données locales et de l'état de synchro,
// 3) l'initialisation du client Supabase et de ses écouteurs,
// 4) l'affichage (splash → app ou écran d'authentification),
// 5) les à-côtés PWA (installation, Service Worker).

import { AppState } from './state.js';
import { supabaseConfigured } from './config.js';
import { render } from './views/shell.js';
import { renderAuthScreen } from './auth.js';
import { loadData } from './db/data.js';
import { initSyncState, initSupabaseClient, startApp, reconcileSync, loadCachedAccessContext } from './db/sync.js';
import { initUploadQueue, processUploadQueue } from './db/upload-queue.js';
import { initInstallPrompt, registerServiceWorker } from './pwa.js';

// Casse le cycle d'import : state.js est un module bas niveau qui ne peut pas
// importer shell.js (haut niveau) sans créer une dépendance circulaire. On
// peuple donc la référence de rendu ici, une fois les deux modules chargés.
AppState.render = render;

document.getElementById('syncBtn').addEventListener('click', () => reconcileSync(true));

(async function init() {
  const minSplash = new Promise(res => setTimeout(res, 1250));
  const localData = await loadData(); // toujours essayé en premier, indépendamment de Supabase
  // La liste des actions locales pas encore envoyées (snapshots de la
  // dernière synchro connue) doit être restaurée dès maintenant, quel que
  // soit le chemin suivi ensuite — sinon les suppressions faites hors ligne
  // ne peuvent plus être détectées lors de la prochaine synchro. Couvre
  // aussi désormais les observations, intégrées au même modèle de données.
  await initSyncState(!!localData);
  // Recharge les dépôts de documents laissés en attente lors d'une session
  // précédente (app fermée hors ligne avant reconnexion) — c'est le seul
  // cas qui a besoin d'une file dédiée, car il s'agit de vrais fichiers
  // binaires. Les observations, elles, voyagent avec le reste des données
  // via initSyncState/reconcileSync ci-dessus, comme les membres ou le
  // pointage.
  await initUploadQueue();

  if (supabaseConfigured() && window.supabase) {
    const syncBtnEl = document.getElementById('syncBtn');
    if (syncBtnEl) syncBtnEl.style.display = 'inline-flex';
    const sb = initSupabaseClient();
    if (sb) {
      try {
        const { data: { session } } = await sb.auth.getSession();
        AppState.sbUser = session ? session.user : null;
        sb.auth.onAuthStateChange((event, session) => {
          const newUser = session ? session.user : null;
          const regained = !AppState.sbUser && newUser;
          AppState.sbUser = newUser;
          if (regained && AppState.data) reconcileSync();
          if (regained) processUploadQueue();
        });
        // En cas de perte de réseau au moment précis du chargement, on retente
        // dès que la connexion revient plutôt que d'attendre indéfiniment.
        window.addEventListener('online', async () => {
          if (!AppState.sb) return;
          try {
            const { data: { session } } = await AppState.sb.auth.getSession();
            const newUser = session ? session.user : null;
            if (newUser && !AppState.sbUser) { AppState.sbUser = newUser; if (AppState.data) reconcileSync(); }
          } catch (e) { /* réessaiera au prochain événement online */ }
          // Le retour en ligne suffit à lui seul à retenter la file d'attente
          // des documents, même si la session était déjà valide (donc pas de
          // "regained" ci-dessus). Les observations, elles, seront poussées
          // par le prochain appel à reconcileSync/pushToSupabase.
          processUploadQueue();
        });
      } catch (e) { AppState.sb = null; }
    }
  }

  await minSplash;
  document.getElementById('splash').classList.add('hide');

  if (localData) {
    // Des données existent déjà sur cet appareil : on entre dans l'app
    // immédiatement, connecté ou non — jamais bloqué par un problème de
    // session ou de réseau. La synchronisation se fait en tâche de fond.
    AppState.data = localData;
    // Le rôle, les Sections et la Section active ne sont pas non plus
    // laissés vides le temps que le réseau confirme quoi que ce soit :
    // on restaure le dernier contexte connu pour que ce tout premier
    // rendu affiche déjà les bons onglets (ex. Administration pour un
    // super-admin) même hors ligne. reconcileSync() ci-dessous corrigera
    // ces valeurs dès qu'une connexion réussit.
    if (AppState.sb && AppState.sbUser) await loadCachedAccessContext();
    render();
    // Important : on NE marque PAS ces données comme déjà synchronisées ici.
    // reconcileSync() pousse d'abord ces données, puis récupère l'état serveur.
    if (AppState.sb && AppState.sbUser) { reconcileSync(); }
  } else if (AppState.sb && !AppState.sbUser) {
    // Aucune donnée locale (tout premier lancement) : il faut être connecté
    // pour récupérer le jeu de données initial.
    renderAuthScreen();
  } else {
    await startApp(localData);
  }

  // Des dépôts de documents ont pu rester en attente d'une session
  // précédente (app fermée hors ligne avant reconnexion) : on retente tout
  // de suite si on est déjà en ligne et connecté, sans attendre un
  // événement 'online' qui ne se déclenchera pas si la connexion était déjà
  // là dès l'ouverture de l'app.
  if (AppState.sb && AppState.sbUser) processUploadQueue();

  initInstallPrompt();
  registerServiceWorker();
})();
