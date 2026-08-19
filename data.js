// db/data.js — Cycle de vie des données locales (IndexedDB + copie de secours
// localStorage) et déclenchement de la synchronisation Supabase après chaque
// sauvegarde. Fait le pont entre l'état applicatif (AppState.data) et le
// stockage persistant.

import { AppState, emptyData, showToast } from '../state.js';
import { idbGet, idbSet, idbDelete } from './indexeddb.js';
import { pushToSupabase, saveSyncState, resetSnapshots, LOCAL_BACKUP_KEY } from './sync.js';

function ensureAmphiField(data) {
  if (data && !Array.isArray(data.amphiDocuments)) data.amphiDocuments = [];
  if (data && !Array.isArray(data.observations)) data.observations = [];
  return data;
}

export async function loadData() {
  try { const v = await idbGet('carnet-data'); if (v) return ensureAmphiField(v); } catch (e) { /* premier lancement ou IndexedDB indisponible */ }
  // Repli : IndexedDB est vide ou en échec, mais une copie de secours synchrone
  // (localStorage) a pu survivre à un arrêt brutal de l'app hors ligne.
  try {
    const backup = localStorage.getItem(LOCAL_BACKUP_KEY);
    if (backup) {
      const parsed = ensureAmphiField(JSON.parse(backup));
      try { await idbSet('carnet-data', parsed); } catch (e) { /* on renvoie quand même la copie récupérée */ }
      return parsed;
    }
  } catch (e) { /* noop */ }
  return null;
}

export async function saveData() {
  // Copie synchrone avant toute attente : elle reste disponible même si l'app se ferme maintenant.
  try { localStorage.setItem(LOCAL_BACKUP_KEY, JSON.stringify(AppState.data)); } catch (e) { /* stockage indisponible */ }
  // On marque la synchronisation avant l'écriture : une fermeture brutale
  // peut ainsi être reprise au prochain démarrage sans perdre une modification.
  await saveSyncState(true);
  try { localStorage.setItem(LOCAL_BACKUP_KEY, JSON.stringify(AppState.data)); } catch (e) { /* stockage indisponible, on continue avec IndexedDB seul */ }
  try { await idbSet('carnet-data', AppState.data); }
  catch (e) { showToast('Échec de la sauvegarde locale'); }
  if (AppState.sb && AppState.sbUser) pushToSupabase();
}

export async function resetAppData() {
  const keepName = AppState.data?.profile?.name || '';
  AppState.data = emptyData();
  AppState.data.profile.name = keepName;
  AppState.tab = 'dashboard';
  AppState.dashProgFilter = 'global';
  AppState.dashYearFilter = 'toutes';
  AppState.pointageProgId = null;
  AppState.pointageSessionId = 'new';
  AppState.pointageDate = new Date().toISOString().slice(0, 10);
  AppState.pointageLabel = '';
  AppState.pointageFastMode = true;
  AppState.importStep = 0;
  AppState.importRows = [];
  AppState.importHeaders = [];
  AppState.importMapping = {};
  AppState.renameModalOpen = false;
  AppState.confirmModalOpen = false;
  AppState.memberDetailId = null;
  AppState.reportScope = 'global';
  AppState.reportSessionId = 'toutes';
  AppState.reportYear = 'toutes';
  AppState.pendingConfirmAction = null;
  resetSnapshots();

  try { await idbDelete('carnet-data'); } catch (e) { /* noop */ }
  try { await idbDelete('carnet-sync-state'); } catch (e) { /* noop */ }
  try { await idbSet('carnet-data', AppState.data); } catch (e) { /* noop */ }
  try { localStorage.setItem(LOCAL_BACKUP_KEY, JSON.stringify(AppState.data)); } catch (e) { /* noop */ }
  try { localStorage.removeItem('carnet-sync-state-backup'); } catch (e) { /* noop */ }

  AppState.render();
  showToast('Données locales réinitialisées');
}
