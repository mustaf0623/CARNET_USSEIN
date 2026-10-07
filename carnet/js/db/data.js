// db/data.js — Cycle de vie des données locales (IndexedDB + copie de secours
// localStorage) et déclenchement de la synchronisation Supabase après chaque
// sauvegarde. Fait le pont entre l'état applicatif (AppState.data) et le
// stockage persistant.
//
// Les données sont mises en cache PAR SECTION (voir dataKey ci-dessous),
// pas dans une case unique : c'est ce qui permet à un super-admin ou un
// compte "pf" de retrouver hors ligne les données d'une Section déjà
// visitée sur cet appareil. loadData()/saveData() gardent la même
// signature qu'avant (aucun appelant ailleurs dans l'app n'a besoin de
// changer) : la Section concernée est déduite de AppState.activeSectionId.

import { AppState, emptyData, showToast } from '../state.js';
import { idbGet, idbSet, idbDelete } from './indexeddb.js';
import { pushToSupabase, saveSyncState, resetSnapshots, LOCAL_BACKUP_KEY } from './sync.js';

function dataKey(sectionId) { return 'carnet-data:' + sectionId; }

function ensureAmphiField(data) {
  if (data && !Array.isArray(data.amphiDocuments)) data.amphiDocuments = [];
  if (data && !Array.isArray(data.observations)) data.observations = [];
  return data;
}

// `sectionId` doit être connu avant l'appel (via loadCachedAccessContext ou
// une connexion réussie) — sans Section active, il n'y a rien à charger.
export async function loadData(sectionId) {
  if (!sectionId) return null;
  try { const v = await idbGet(dataKey(sectionId)); if (v) return ensureAmphiField(v); } catch (e) { /* première visite de cette Section, ou IndexedDB indisponible */ }
  // Repli 1 : ancienne clé unique, antérieure à la gestion multi-Section —
  // à n'utiliser qu'une fois, puis réécrite sous la nouvelle clé pour ne
  // rien perdre de ce qui était déjà en cache sur cet appareil.
  try {
    const legacy = await idbGet('carnet-data');
    if (legacy) {
      const parsed = ensureAmphiField(legacy);
      try { await idbSet(dataKey(sectionId), parsed); await idbDelete('carnet-data'); } catch (e) { /* on renvoie quand même la copie récupérée */ }
      return parsed;
    }
  } catch (e) { /* noop */ }
  // Repli 2 : IndexedDB est vide ou en échec, mais une copie de secours
  // synchrone (localStorage) a pu survivre à un arrêt brutal hors ligne.
  try {
    const backup = localStorage.getItem(LOCAL_BACKUP_KEY);
    if (backup) {
      const parsed = ensureAmphiField(JSON.parse(backup));
      try { await idbSet(dataKey(sectionId), parsed); } catch (e) { /* on renvoie quand même la copie récupérée */ }
      return parsed;
    }
  } catch (e) { /* noop */ }
  return null;
}

export async function saveData() {
  const sectionId = AppState.activeSectionId;
  // Copie synchrone avant toute attente : elle reste disponible même si l'app se ferme maintenant.
  try { localStorage.setItem(LOCAL_BACKUP_KEY, JSON.stringify(AppState.data)); } catch (e) { /* stockage indisponible */ }
  // On marque la synchronisation avant l'écriture : une fermeture brutale
  // peut ainsi être reprise au prochain démarrage sans perdre une modification.
  await saveSyncState(true);
  try { localStorage.setItem(LOCAL_BACKUP_KEY, JSON.stringify(AppState.data)); } catch (e) { /* stockage indisponible, on continue avec IndexedDB seul */ }
  if (sectionId) {
    try { await idbSet(dataKey(sectionId), AppState.data); }
    catch (e) { showToast('Échec de la sauvegarde locale'); }
  }
  if (AppState.sb && AppState.sbUser) pushToSupabase();
}

// "Zone sensible" : ne réinitialise QUE la Section actuellement active,
// jamais les autres Sections en cache sur cet appareil.
export async function resetAppData() {
  const keepName = AppState.data?.profile?.name || '';
  const sectionId = AppState.activeSectionId;
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

  if (sectionId) { try { await idbDelete(dataKey(sectionId)); } catch (e) { /* noop */ } }
  resetSnapshots();
  await saveSyncState(false);
  if (sectionId) { try { await idbSet(dataKey(sectionId), AppState.data); } catch (e) { /* noop */ } }
  try { localStorage.setItem(LOCAL_BACKUP_KEY, JSON.stringify(AppState.data)); } catch (e) { /* noop */ }
  try { localStorage.removeItem('carnet-sync-state-backup'); } catch (e) { /* noop */ }

  AppState.render();
  showToast('Données locales réinitialisées');
}
