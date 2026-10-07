// domain/membres.js — Règles métier pures liées aux membres et programmes.
// Aucune manipulation du DOM ici : uniquement des fonctions de lecture/calcul
// sur l'objet `data` (programmes, membres, sessions, pointages), plus une
// mutation ciblée (checkApPromotion) qui reste un calcul de règle métier.

import { normKey } from '../config.js';

export function memberInProgramme(m, progId) {
  return !!m.allProgrammes || m.programmeIds.includes(progId);
}

// Cherche dans les informations importées (`extra`) la première clé dont le
// nom normalisé correspond exactement ou contient le motif recherché.
// Partagé par toutes les recherches de champ importé (UFR, Filière, niveau
// d'étude...), pour rester cohérent avec la façon dont les en-têtes Excel
// sont reconnues partout ailleurs dans l'app.
export function findExtraKey(extra, wanted) {
  return Object.keys(extra || {}).find(k => normKey(k) === wanted || normKey(k).includes(wanted));
}

// Toutes les colonnes déjà connues depuis un import précédent (base
// importée), utilisées pour proposer les mêmes champs lors d'un ajout
// manuel de membre permanent.
export function extraFieldKeys(data) {
  const keys = new Set();
  data.membres.forEach(m => Object.keys(m.extra || {}).forEach(k => keys.add(k)));
  return Array.from(keys);
}

// Récupère UFR/Filière d'un membre depuis la base importée. Ces deux
// en-têtes figurent toujours tels quels dans les fichiers importés.
export function getMemberUfrFiliere(membre) {
  const extra = (membre && membre.extra) || {};
  const ufrKey = findExtraKey(extra, 'ufr');
  const filiereKey = findExtraKey(extra, 'filiere');
  return { ufr: ufrKey ? String(extra[ufrKey]).trim() : '', filiere: filiereKey ? String(extra[filiereKey]).trim() : '' };
}

export function amphiUfrFiliereOptions(data) {
  const set = new Map();
  data.membres.forEach(m => {
    const { ufr, filiere } = getMemberUfrFiliere(m);
    if (ufr && filiere) set.set(ufr + '|||' + filiere, { ufr, filiere });
  });
  return Array.from(set.values()).sort((a, b) => (a.ufr + a.filiere).localeCompare(b.ufr + b.filiere));
}

/* ================= Membres "Sortants" ================= */
// Un membre est "Sortant" dès que son niveau d'étude importé (colonne dont
// le nom contient "niveau") vaut "Sortant" (accents/casse ignorés). Ces
// membres deviennent de simples figurants : exclus des statistiques, du
// tableau de bord, des rapports et des exports, mais restent pointables
// ponctuellement (cf. Pointage) et consultables via l'onglet dédié Sortants.
export const SORTANT_GRACE_DAYS = 7;

export function getNiveauEtude(membre) {
  const extra = (membre && membre.extra) || {};
  const key = findExtraKey(extra, 'niveau');
  return key ? String(extra[key]).trim() : '';
}

export function isSortant(membre) {
  return normKey(getNiveauEtude(membre)).includes('sortant');
}

/* ================= Niveau d'étude (L1 → M2) ================= */
// Même colonne importée que pour la détection des Sortants ("niveau
// d'étude"), mais normalisée vers l'un des 5 codes standards — tolère les
// variantes courantes ("Licence 1", "L1", "1ère année"...). Sert à organiser
// les documents de l'Amphithéâtre par niveau, en plus de l'UFR/Filière.
export const NIVEAU_CODES = ['L1', 'L2', 'L3', 'M1', 'M2'];
const NIVEAU_PATTERNS = [
  { code: 'L1', re: /\bl\s*1\b|licence\s*1|1(ere|ère)?\s*annee.*licence|licence.*1(ere|ère)?\s*annee/ },
  { code: 'L2', re: /\bl\s*2\b|licence\s*2|2(eme|ème)?\s*annee.*licence|licence.*2(eme|ème)?\s*annee/ },
  { code: 'L3', re: /\bl\s*3\b|licence\s*3|3(eme|ème)?\s*annee.*licence|licence.*3(eme|ème)?\s*annee/ },
  { code: 'M1', re: /\bm\s*1\b|master\s*1|1(ere|ère)?\s*annee.*master|master.*1(ere|ère)?\s*annee/ },
  { code: 'M2', re: /\bm\s*2\b|master\s*2|2(eme|ème)?\s*annee.*master|master.*2(eme|ème)?\s*annee/ },
];
export function getNiveauCode(membre) {
  const raw = normKey(getNiveauEtude(membre));
  if (!raw) return '';
  const found = NIVEAU_PATTERNS.find(p => p.re.test(raw));
  return found ? found.code : '';
}

// Nombre de jours écoulés depuis que le membre est devenu Sortant, ou null
// si l'information n'est pas connue (jamais marqué Sortant dans l'app).
export function daysSinceSortant(membre) {
  if (!membre || !membre.sortantSince) return null;
  const since = new Date(membre.sortantSince + 'T00:00:00');
  if (Number.isNaN(since.getTime())) return null;
  const now = new Date();
  return Math.floor((now - since) / 86400000);
}

// Un compte lié à ce membre doit perdre l'accès à l'app une fois le délai
// de grâce dépassé. Ce calcul est dupliqué côté serveur (RLS) pour la
// sécurité réelle ; ici il sert uniquement à afficher un message clair.
export function hasSortantAccessExpired(membre) {
  const days = daysSinceSortant(membre);
  return days !== null && days >= SORTANT_GRACE_DAYS;
}

// Un membre "Ponctuel (AP)" est intégré définitivement à la base dès qu'il a été
// pointé (présent ou absent) à plus de 6 séances réparties sur au moins 3 programmes.
export function checkApPromotion(data, membreId) {
  const m = data.membres.find(x => x.id === membreId);
  if (!m || !m.ap) return false;
  const pts = data.pointages.filter(p => p.membreId === membreId);
  const sessionIds = Array.from(new Set(pts.map(p => p.sessionId)));
  const sessions = sessionIds.map(id => data.sessions.find(s => s.id === id)).filter(Boolean);
  const nbProgrammes = new Set(sessions.map(s => s.programmeId)).size;
  if (sessions.length > 6 && nbProgrammes >= 3) {
    m.ap = false;
    return true;
  }
  return false;
}
