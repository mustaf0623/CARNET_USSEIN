// state.js — État mutable partagé de l'application.
//
// Pourquoi un objet unique (`AppState`) plutôt que des `let` exportés dans
// chaque module ? En ES modules, une liaison importée est en lecture seule :
// un autre module ne peut pas faire `sbUser = x`. En regroupant tout l'état
// partagé dans un seul objet muté par propriété, n'importe quel module peut
// lire ET écrire l'état sans réassigner de binding d'import.
//
// `AppState.render` est peuplé par main.js une fois le shell chargé : cela
// évite un import circulaire entre state.js (bas niveau) et shell.js (haut
// niveau) tout en permettant à n'importe quel module d'appeler `render()`.

export const AppState = {
  // ---- Données métier + état des vues ----
  data: null,
  tab: 'dashboard',
  absenceThreshold: 3,
  amphiUfr: '',
  amphiFiliere: '',
  amphiSearch: '',
  dashProgFilter: 'global',
  dashYearFilter: 'toutes',
  pointageProgId: null,
  pointageSessionId: 'new',
  pointageDate: new Date().toISOString().slice(0, 10),
  pointageLabel: '',
  pointageFastMode: true,
  importStep: 0,
  importRows: [],
  importHeaders: [],
  importMapping: {},
  renameModalOpen: false,
  confirmModalOpen: false,
  confirmTitle: '',
  confirmMessage: '',
  confirmLabel: 'Confirmer',
  memberDetailId: null,
  completeInfoQueue: [],
  reportScope: 'global',
  reportSessionId: 'toutes',
  reportYear: 'toutes',
  activeSectionId: null,
  membreSearch: '',
  membresSubTab: 'actifs',
  watchlistProgramme: 'tous',
  pendingConfirmAction: null,

  // ---- Session / synchronisation Supabase ----
  sb: null,
  sbUser: null,
  sbProfile: null,
  sbSections: [],
  sbUsers: [],
  // Membre lié au compte courant (rôle "utilisateur", récupéré via la RPC
  // dédiée get_my_membre_info — la table membres lui est inaccessible en
  // lecture directe). null tant que non chargé ou non applicable.
  myMembreInfo: null,
  // Dépôts de documents Amphithéâtre en attente d'envoi (hors ligne ou
  // échec réseau) — chaque item peut contenir des objets File bruts.
  amphiUploadQueue: [],

  // ---- Liaison vers le rendu racine (peuplée par main.js) ----
  render: () => {},
};

export function emptyData() {
  return { profile: { name: '' }, programmes: [], membres: [], sessions: [], pointages: [], amphiDocuments: [] };
}

export function showToast(msg, icon) {
  const t = document.getElementById('toast');
  t.innerHTML = (icon || '') + '<span>' + msg + '</span>';
  t.classList.add('show');
  clearTimeout(window.__toastTimer);
  window.__toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

export function openConfirm(title, message, action, confirmLabel) {
  AppState.pendingConfirmAction = action;
  AppState.confirmTitle = title;
  AppState.confirmMessage = message;
  AppState.confirmLabel = confirmLabel || 'Supprimer';
  AppState.confirmModalOpen = true;
  AppState.render();
}
