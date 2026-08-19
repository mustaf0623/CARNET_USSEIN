// db/sync.js — Synchronisation multi-appareils via Supabase.
// Regroupe : initialisation du client, push/pull, snapshots de réconciliation,
// abonnement temps réel, et le point d'entrée `startApp` / `reconcileSync`.
//
// L'état de session (sb, sbUser, sbProfile, sbSections, sbUsers) et l'état
// métier (AppState.data, AppState.activeSectionId) vivent dans AppState —
// voir state.js pour la justification de ce choix.

import { AppState, showToast, emptyData, openConfirm } from '../state.js';
import { SUPABASE_URL, SUPABASE_ANON_KEY, supabaseConfigured } from '../config.js';
import { idbGet, idbSet, idbDelete } from './indexeddb.js';

const SYNC_STATE_KEY = 'carnet-sync-state';
const ACCESS_CONTEXT_KEY = 'carnet-access-context';
const SYNC_STATE_BACKUP_KEY = 'carnet-sync-state-backup';
export const LOCAL_BACKUP_KEY = 'carnet-data-backup';

const snapshotMaps = { programmes: new Map(), membres: new Map(), sessions: new Map(), pointages: new Map(), amphiDocuments: new Map(), observations: new Map() };
let syncState = { pending: false, snapshots: null };

function serialiseSnapshots() {
  return Object.fromEntries(Object.entries(snapshotMaps).map(([table, map]) => [table, Array.from(map.entries())]));
}
function restoreSnapshots(snapshots) {
  if (!snapshots) return;
  Object.keys(snapshotMaps).forEach(table => { snapshotMaps[table] = new Map(snapshots[table] || []); });
}
async function loadSyncState() {
  try { const saved = await idbGet(SYNC_STATE_KEY); if (saved) return saved; } catch (e) { /* copie de secours ci-dessous */ }
  try { const backup = localStorage.getItem(SYNC_STATE_BACKUP_KEY); return backup ? JSON.parse(backup) : null; } catch (e) { return null; }
}
export async function saveSyncState(pending) {
  syncState = { pending: !!pending, snapshots: serialiseSnapshots() };
  try { localStorage.setItem(SYNC_STATE_BACKUP_KEY, JSON.stringify(syncState)); } catch (e) { /* stockage indisponible */ }
  try { await idbSet(SYNC_STATE_KEY, syncState); } catch (e) { /* la copie locale reste disponible */ }
}

// À appeler une fois au démarrage (main.js) : restaure l'état de synchro
// connu (snapshots + drapeau "en attente") avant toute tentative de push/pull.
export async function initSyncState(hasLocalData) {
  const loaded = await loadSyncState();
  syncState = loaded || (hasLocalData ? { pending: true, snapshots: null } : syncState);
  if (syncState.snapshots) restoreSnapshots(syncState.snapshots);
}
export function isSyncPending() { return !!syncState.pending; }

export function updateSnapshotsFromCurrent() {
  const d = AppState.data;
  snapshotMaps.programmes = new Map(d.programmes.map(r => [r.id, JSON.stringify(r)]));
  snapshotMaps.membres = new Map(d.membres.map(r => [r.id, JSON.stringify(r)]));
  snapshotMaps.sessions = new Map(d.sessions.map(r => [r.id, JSON.stringify(r)]));
  snapshotMaps.pointages = new Map(d.pointages.map(r => [r.id, JSON.stringify(r)]));
  snapshotMaps.amphiDocuments = new Map((d.amphiDocuments || []).map(r => [r.id, JSON.stringify(r)]));
  snapshotMaps.observations = new Map((d.observations || []).map(r => [r.id, JSON.stringify(r)]));
}
export function resetSnapshots() {
  snapshotMaps.programmes = new Map();
  snapshotMaps.membres = new Map();
  snapshotMaps.sessions = new Map();
  snapshotMaps.pointages = new Map();
  snapshotMaps.amphiDocuments = new Map();
  snapshotMaps.observations = new Map();
}

export async function pullFromSupabase() {
  const sb = AppState.sb, sbUser = AppState.sbUser;
  const sectionId = AppState.activeSectionId;
  if (!sectionId) return emptyData();
  const scoped = table => sb.from(table).select('*').eq('section_id', sectionId);
  const [progRes, memRes, sessRes, ptRes, profRes, amphiRes, obsRes] = await Promise.all([
    scoped('programmes'),
    scoped('membres'),
    scoped('sessions'),
    scoped('pointages'),
    sb.from('profiles').select('*').eq('id', sbUser.id).maybeSingle(),
    scoped('amphi_documents'),
    scoped('observations'),
  ]);
  if (progRes.error) throw progRes.error;
  const programmes = (progRes.data || []).map(r => ({ id: r.id, nom: r.nom }));
  const membres = (memRes.data || []).map(r => ({ id: r.id, nom: r.nom, prenom: r.prenom, sexe: r.sexe, programmeIds: r.programme_ids || [], allProgrammes: !!r.all_programmes, ap: !!r.ap, extra: r.extra || {}, sortantSince: r.sortant_since || null }));
  const sessions = (sessRes.data || []).map(r => ({ id: r.id, programmeId: r.programme_id, date: r.date, label: r.label }));
  const pointages = (ptRes.data || []).map(r => ({ id: r.id, sessionId: r.session_id, membreId: r.membre_id, statut: r.statut }));
  const amphiDocuments = (amphiRes.data || []).map(r => ({
    id: r.id, ufr: r.ufr, filiere: r.filiere, niveau: r.niveau || '', type: r.type, titre: r.titre, reference: r.reference || '',
    fileName: r.file_name || '', storagePath: r.storage_path || '',
    correctionFileName: r.correction_file_name || '', correctionStoragePath: r.correction_storage_path || '',
    lienUrl: r.lien_url || '', uploaderName: r.uploader_name || '', uploaderUserId: r.uploader_user_id || '',
    createdAt: r.created_at,
  }));
  const observations = (obsRes.data || []).map(r => ({
    id: r.id, authorUserId: r.author_user_id || '', authorName: r.author_name || '', authorRole: r.author_role || '',
    content: r.content, createdAt: r.created_at, updatedAt: r.updated_at,
  }));
  // Le nom du signataire ne doit JAMAIS être effacé par un pull : si le
  // serveur ne renvoie rien, on garde le nom déjà connu localement — et on
  // en profite pour tenter de réparer l'enregistrement côté serveur.
  const remoteName = (profRes.data && profRes.data.name) || '';
  const localName = (AppState.data && AppState.data.profile && AppState.data.profile.name) || '';
  const name = remoteName || localName;
  if (!remoteName && localName) {
    try { await sb.from('profiles').upsert({ id: sbUser.id, name: localName }); } catch (e) { /* non bloquant, retenté plus tard */ }
  }
  return { profile: { name }, programmes, membres, sessions, pointages, amphiDocuments, observations };
}

export async function loadAccessContext() {
  const sb = AppState.sb, sbUser = AppState.sbUser;
  const { data: profile, error: profileError } = await sb.from('profiles')
    .select('id, name, email, role, section_id, active, matched_membre_id').eq('id', sbUser.id).maybeSingle();
  if (profileError || !profile) throw profileError || new Error('profil introuvable');
  AppState.sbProfile = { id: profile.id, name: profile.name || '', email: profile.email || '', role: profile.role || 'utilisateur', sectionId: profile.section_id, active: profile.active !== false, matchedMembreId: profile.matched_membre_id || null };
  const { data: sections, error: sectionError } = await sb.from('sections').select('id, nom').order('nom');
  if (sectionError) throw sectionError;
  AppState.sbSections = sections || [];
  if (AppState.sbProfile.role === 'super_admin') {
    const { data: users, error: usersError } = await sb.from('profiles').select('id, name, email, role, section_id, active, matched_membre_id').order('created_at');
    if (usersError) throw usersError;
    AppState.sbUsers = users || [];
  }
  // "pf" a accès à toutes les Sections, comme un super-admin, mais en
  // lecture seule (imposé côté RLS) — même logique de Section active :
  // celle déjà choisie, sinon celle de son profil, sinon la première
  // disponible. Sans ce traitement particulier, un compte "pf" sans
  // section_id renseigné se retrouverait bloqué sur l'écran "en attente".
  if (AppState.sbProfile.role === 'super_admin' || AppState.sbProfile.role === 'pf') {
    AppState.activeSectionId = AppState.activeSectionId || AppState.sbProfile.sectionId || AppState.sbSections[0]?.id || null;
  } else {
    AppState.activeSectionId = AppState.sbProfile.sectionId;
  }

  // La table `membres` est inaccessible en lecture directe pour le rôle
  // "utilisateur" (RLS réservée à CA/super-admin) : le seul canal autorisé
  // pour connaître son propre membre lié (UFR/Filière, nom, statut Sortant)
  // est cette RPC dédiée, qui ne renvoie jamais que sa propre ligne.
  if (AppState.sbProfile.role === 'utilisateur') {
    try {
      const { data: rows, error } = await sb.rpc('get_my_membre_info');
      if (error) throw error;
      AppState.myMembreInfo = (rows && rows[0]) || null;
    } catch (e) {
      AppState.myMembreInfo = null;
    }
  } else {
    AppState.myMembreInfo = null;
  }

  // Contrairement à AppState.data (programmes/membres/pointages...), le
  // contexte d'accès (rôle, Sections, Section active, membre lié) n'était
  // jusqu'ici JAMAIS mis en cache localement — uniquement re-dérivé d'un
  // appel réseau à chaque démarrage. Résultat : un redémarrage hors ligne
  // (fréquent sur mobile, l'OS pouvant tuer l'app en arrière-plan) faisait
  // repartir sbProfile à null le temps que cet appel échoue, cachant à tort
  // des éléments d'interface propres au rôle (ex. l'onglet Administration,
  // réservé au strict test role==='super_admin') alors même que les
  // données de la Section, elles, restaient disponibles hors ligne.
  await persistAccessContext();
}

async function persistAccessContext() {
  try {
    await idbSet(ACCESS_CONTEXT_KEY, {
      sbProfile: AppState.sbProfile,
      sbSections: AppState.sbSections,
      activeSectionId: AppState.activeSectionId,
      myMembreInfo: AppState.myMembreInfo,
    });
  } catch (e) { /* pas grave, on retentera à la prochaine connexion réussie */ }
}

// À appeler au démarrage lorsque des données locales existent déjà, avant
// même que le réseau ait pu confirmer quoi que ce soit : restaure le
// dernier contexte d'accès connu pour que le premier rendu (sidebar,
// onglets visibles, sélecteur de Section) soit correct dès hors ligne.
// reconcileSync()/startApp() corrigeront ces valeurs dès qu'une connexion
// réussit — ceci n'est qu'un point de départ pour le rendu immédiat.
export async function loadCachedAccessContext() {
  try {
    const cached = await idbGet(ACCESS_CONTEXT_KEY);
    if (!cached) return false;
    AppState.sbProfile = cached.sbProfile || null;
    AppState.sbSections = cached.sbSections || [];
    AppState.activeSectionId = cached.activeSectionId || null;
    AppState.myMembreInfo = cached.myMembreInfo || null;
    return true;
  } catch (e) {
    return false;
  }
}

async function syncTable(tableName, rows, toRemote, prevMap) {
  const sb = AppState.sb;
  const currMap = new Map(rows.map(r => [r.id, JSON.stringify(r)]));
  const toUpsert = [];
  currMap.forEach((json, id) => { if (prevMap.get(id) !== json) toUpsert.push(JSON.parse(json)); });
  const toDelete = [];
  prevMap.forEach((_, id) => { if (!currMap.has(id)) toDelete.push(id); });
  if (toUpsert.length) { const { error } = await sb.from(tableName).upsert(toUpsert.map(toRemote)); if (error) throw error; }
  if (toDelete.length) { const { error } = await sb.from(tableName).delete().in('id', toDelete); if (error) throw error; }
  return currMap;
}

let syncing = false;
let syncQueued = false;
export async function pushToSupabase() {
  const sb = AppState.sb, sbUser = AppState.sbUser;
  if (!sb || !sbUser) return false;
  if (syncing) { syncQueued = true; return false; }
  syncing = true;
  try {
    // Le nom du signataire est lié au compte, pas à une Section : on
    // l'enregistre en premier et indépendamment du reste, sinon il ne serait
    // jamais sauvegardé tant qu'aucune Section n'est active.
    try { await sb.from('profiles').upsert({ id: sbUser.id, name: AppState.data.profile.name }); } catch (e) { /* non bloquant */ }
    const section_id = AppState.activeSectionId;
    if (!section_id) throw new Error('Aucune Section attribuée');
    const d = AppState.data;
    snapshotMaps.programmes = await syncTable('programmes', d.programmes, p => ({ id: p.id, nom: p.nom, section_id }), snapshotMaps.programmes);
    snapshotMaps.membres = await syncTable('membres', d.membres, m => ({ id: m.id, nom: m.nom, prenom: m.prenom, sexe: m.sexe, programme_ids: m.programmeIds || [], all_programmes: !!m.allProgrammes, ap: !!m.ap, extra: m.extra || {}, sortant_since: m.sortantSince || null, section_id }), snapshotMaps.membres);
    snapshotMaps.sessions = await syncTable('sessions', d.sessions, s => ({ id: s.id, programme_id: s.programmeId, date: s.date, label: s.label, section_id }), snapshotMaps.sessions);
    snapshotMaps.pointages = await syncTable('pointages', d.pointages, p => ({ id: p.id, session_id: p.sessionId, membre_id: p.membreId, statut: p.statut, section_id }), snapshotMaps.pointages);
    snapshotMaps.amphiDocuments = await syncTable('amphi_documents', d.amphiDocuments || [], a => ({
      id: a.id, section_id, ufr: a.ufr, filiere: a.filiere, niveau: a.niveau || '', type: a.type, titre: a.titre, reference: a.reference || '',
      file_name: a.fileName || null, storage_path: a.storagePath || null,
      correction_file_name: a.correctionFileName || null, correction_storage_path: a.correctionStoragePath || null,
      lien_url: a.lienUrl || null, uploader_name: a.uploaderName || '', uploader_user_id: a.uploaderUserId || null,
    }), snapshotMaps.amphiDocuments);
    snapshotMaps.observations = await syncTable('observations', d.observations || [], o => ({
      id: o.id, section_id, author_user_id: o.authorUserId || null, author_name: o.authorName || '', author_role: o.authorRole || '',
      content: o.content, created_at: o.createdAt || new Date().toISOString(), updated_at: o.updatedAt || o.createdAt || new Date().toISOString(),
    }), snapshotMaps.observations);
    await saveSyncState(false);
    return true;
  } catch (e) {
    console.error('Carnet — échec pushToSupabase:', e);
    showToast('Échec de synchronisation : ' + (e && e.message ? e.message : 'erreur inconnue'));
    return false;
  } finally {
    syncing = false;
    // Une sauvegarde a eu lieu pendant cet envoi : on relance immédiatement
    // pour ne jamais laisser un changement local sans tentative d'envoi.
    if (syncQueued) { syncQueued = false; pushToSupabase(); }
  }
}

let remoteChangeTimer = null;
function handleRemoteChange() {
  clearTimeout(remoteChangeTimer);
  remoteChangeTimer = setTimeout(async () => {
    try {
      if (!AppState.activeSectionId) return;
      // On envoie d'abord tout changement local en attente : sans ça, un
      // rafraîchissement déclenché par le changement d'un autre appareil
      // pourrait écraser une saisie locale pas encore synchronisée.
      await pushToSupabase();
      const remote = await pullFromSupabase();
      AppState.data.programmes = remote.programmes;
      AppState.data.membres = remote.membres;
      AppState.data.sessions = remote.sessions;
      AppState.data.pointages = remote.pointages;
      AppState.data.amphiDocuments = remote.amphiDocuments;
      AppState.data.observations = remote.observations;
      updateSnapshotsFromCurrent();
      await idbSet('carnet-data', AppState.data);
      showToast('Données mises à jour depuis un autre appareil');
      AppState.render();
    } catch (e) { /* on retentera au prochain changement */ }
  }, 900);
}
let realtimeChannel = null;
export function subscribeRealtime() {
  const sb = AppState.sb, sbUser = AppState.sbUser;
  if (!sb || !sbUser) return;
  if (realtimeChannel) return;
  realtimeChannel = sb
    .channel('carnet-sync')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'programmes' }, handleRemoteChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'membres' }, handleRemoteChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'sessions' }, handleRemoteChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'pointages' }, handleRemoteChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'amphi_documents' }, handleRemoteChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'observations' }, handleRemoteChange)
    .subscribe();
}

/* ================= Démarrage & réconciliation ================= */

export async function startApp(localData) {
  let data = localData || emptyData();
  let remoteReady = false;
  if (AppState.sb && AppState.sbUser) {
    try {
      await loadAccessContext();
      if (!AppState.sbProfile.active || !AppState.activeSectionId) {
        // Compte pas encore rattaché à une Section (ou désactivé) : on ne
        // doit surtout pas écraser les données locales déjà présentes,
        // en particulier le nom du signataire saisi avant la connexion.
        AppState.data = localData || emptyData();
        if (localData && localData.profile && localData.profile.name) {
          try { await AppState.sb.from('profiles').upsert({ id: AppState.sbUser.id, name: localData.profile.name }); } catch (e) { /* non bloquant, retenté plus tard */ }
        }
        AppState.render();
        return;
      }
      if (localData && isSyncPending()) {
        AppState.data = localData;
        if (!await pushToSupabase()) throw new Error('synchronisation locale impossible');
      }
      data = await pullFromSupabase();
      if (!data.profile.name && localData && localData.profile.name) data.profile.name = localData.profile.name;
      await idbSet('carnet-data', data);
      remoteReady = true;
    } catch (e) {
      data = localData || emptyData();
      showToast('Connexion au serveur impossible — mode hors-ligne local');
    }
  }
  AppState.data = data;
  if (AppState.sb && AppState.sbUser) { updateSnapshotsFromCurrent(); if (remoteReady) await saveSyncState(false); subscribeRealtime(); }
  AppState.render();
}

// Appelée quand une session valide (re)devient disponible pendant que l'app
// tourne déjà avec des données locales — pousse les changements faits hors
// ligne, puis récupère ce que les autres appareils ont pu modifier entretemps.
let reconciling = false;
export async function reconcileSync(manual) {
  const sb = AppState.sb;
  if (!sb || reconciling) { if (manual) showToast('Synchronisation déjà en cours'); return; }
  if (!AppState.sbUser) {
    // On retente de récupérer une session avant d'abandonner — utile après
    // une reconnexion réseau où le jeton vient tout juste d'être rafraîchi.
    try { const { data: { session } } = await sb.auth.getSession(); AppState.sbUser = session ? session.user : null; } catch (e) { /* noop */ }
  }
  if (!AppState.sbUser || !AppState.data) {
    if (manual) showToast('Pas de session active — reconnectez-vous');
    return;
  }
  reconciling = true;
  const btn = document.getElementById('syncBtn');
  if (btn) { btn.classList.add('spinning'); btn.disabled = true; }
  try {
    // AppState.activeSectionId n'est jamais persisté localement : sur un
    // retour en ligne après un chargement avec données locales, il n'a
    // encore jamais été rempli. On le (re)charge avant toute chose.
    await loadAccessContext();
    if (!AppState.sbProfile.active || !AppState.activeSectionId) {
      if (manual) showToast('Compte en attente de rattachement à une Section');
      return;
    }
    await pushToSupabase();
    const remote = await pullFromSupabase();
    AppState.data.programmes = remote.programmes;
    AppState.data.membres = remote.membres;
    AppState.data.sessions = remote.sessions;
    AppState.data.pointages = remote.pointages;
    AppState.data.amphiDocuments = remote.amphiDocuments;
    AppState.data.observations = remote.observations;
    if (!AppState.data.profile.name && remote.profile.name) AppState.data.profile.name = remote.profile.name;
    updateSnapshotsFromCurrent();
    await idbSet('carnet-data', AppState.data);
    subscribeRealtime();
    showToast(manual ? 'Données synchronisées ✓' : 'Reconnecté — données synchronisées');
    AppState.render();
  } catch (e) {
    console.error('Carnet — échec reconcileSync:', e);
    if (manual) showToast('Échec : ' + (e && e.message ? e.message : 'connexion impossible'));
  } finally {
    reconciling = false;
    if (btn) { btn.classList.remove('spinning'); btn.disabled = false; }
  }
}

export function signOutSupabase() {
  const sb = AppState.sb;
  if (!sb) return;
  openConfirm(
    'Se déconnecter ?',
    'Il faudra une connexion internet pour se reconnecter et retrouver l’accès à l’app sur cet appareil.',
    async () => {
      try { await sb.auth.signOut(); } catch (e) { /* on nettoie quand même localement */ }
      AppState.sbUser = null;
      try { await idbDelete('carnet-data'); } catch (e) { /* noop */ }
      try { await idbDelete(SYNC_STATE_KEY); } catch (e) { /* noop */ }
      try { await idbDelete(ACCESS_CONTEXT_KEY); } catch (e) { /* noop */ }
      try { localStorage.removeItem(LOCAL_BACKUP_KEY); } catch (e) { /* noop */ }
      try { localStorage.removeItem(SYNC_STATE_BACKUP_KEY); } catch (e) { /* noop */ }
      location.reload();
    },
    'Se déconnecter'
  );
}

export function initSupabaseClient() {
  if (!supabaseConfigured() || !window.supabase) return null;
  try {
    const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    AppState.sb = sb;
    return sb;
  } catch (e) {
    AppState.sb = null;
    return null;
  }
}
