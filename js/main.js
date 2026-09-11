// main.js — Point d'entrée de l'application. Orchestre, dans l'ordre :
// 1) le câblage de AppState.render vers le shell (casse le cycle d'import),
// 2) l'initialisation du client Supabase et de la session,
// 3) la restauration du contexte d'accès en cache (rôle, Sections, Section
//    active) — nécessaire pour savoir QUELLES données locales charger,
// 4) le chargement des données locales de cette Section + l'état de synchro,
// 5) l'affichage (splash → app ou écran d'authentification),
// 6) les à-côtés PWA (installation, Service Worker).
//
// Cet ordre est important : avec la gestion multi-Section (cache local par
// Section), il faut savoir QUELLE Section était active avant de pouvoir
// charger les bonnes données locales — d'où la restauration du contexte
// d'accès en cache AVANT loadData(), et non après comme auparavant.

import { AppState } from './state.js';
import { supabaseConfigured } from './config.js';
import { render } from './views/shell.js';
import { renderAuthScreen } from './auth.js';
import { loadData } from './db/data.js';
import { initSyncState, initSupabaseClient, startApp, reconcileSync, loadCachedAccessContext } from './db/sync.js';
import { initUploadQueue, processUploadQueue } from './db/upload-queue.js';
import { initInstallPrompt, registerServiceWorker } from './pwa.js';

initInstallPrompt();
registerServiceWorker();

// Casse le cycle d'import : state.js est un module bas niveau qui ne peut pas
// importer shell.js (haut niveau) sans créer une dépendance circulaire. On
// peuple donc la référence de rendu ici, une fois les deux modules chargés.
AppState.render = render;

document.getElementById('syncBtn').addEventListener('click', () => reconcileSync(true));

(async function init() {
  const minSplash = new Promise(res => setTimeout(res, 1250));

  // 1) Client Supabase + session courante, dès que possible.
  let sb = null;
  if (supabaseConfigured() && window.supabase) {
    const syncBtnEl = document.getElementById('syncBtn');
    if (syncBtnEl) syncBtnEl.style.display = 'inline-flex';
    sb = initSupabaseClient();
    if (sb) {
      try {
        const { data: { session } } = await sb.auth.getSession();
        AppState.sbUser = session ? session.user : null;
      } catch (e) { AppState.sb = null; sb = null; }
    }
  }

  // 2) Contexte d'accès en cache (rôle, Sections, Section active, membre
  // lié) — restauré AVANT de charger les données, pour savoir quelle
  // Section charger localement à l'étape suivante. C'est ce qui permet à
  // un super-admin/"pf" de retrouver hors ligne une Section déjà visitée.
  if (AppState.sb && AppState.sbUser) await loadCachedAccessContext();

  // 3) Données locales de la Section active (si connue) + état de synchro.
  const localData = await loadData(AppState.activeSectionId);
  await initSyncState(!!localData);
  // Recharge les dépôts de documents laissés en attente lors d'une session
  // précédente (app fermée hors ligne avant reconnexion) — c'est le seul
  // cas qui a besoin d'une file dédiée, car il s'agit de vrais fichiers
  // binaires. Les observations, elles, voyagent avec le reste des données
  // via initSyncState/reconcileSync, comme les membres ou le pointage.
  await initUploadQueue();

  // 4) Écouteurs d'authentification (regain de session, retour en ligne).
  if (sb) {
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
  }

  await minSplash;
  document.getElementById('splash').classList.add('hide');

  if (localData) {
    // Des données existent déjà sur cet appareil pour cette Section : on
    // entre dans l'app immédiatement, connecté ou non — jamais bloqué par
    // un problème de session ou de réseau. La synchronisation se fait en
    // tâche de fond.
    AppState.data = localData;
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

})();
