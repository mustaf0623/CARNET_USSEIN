// config.js — Constantes globales, icônes SVG et fonctions utilitaires pures.
// Aucun état mutable ici : uniquement des valeurs figées et des fonctions sans effet de bord.

export const ICONS = {
  mark: `<svg viewBox="0 0 24 24" fill="none"><path d="M19.8 3.2a2.1 2.1 0 013 3L9.5 19.4l-4 1 1-4L19.8 3.2z" fill="#4F6B4D" stroke="#F1ECDE" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M17 6l3 3" stroke="#F1ECDE" stroke-width="1.3" stroke-linecap="round"/><path d="M2.6 20c1.1-1.9 2.2-1.9 3.3 0s2.2-1.9 3.3-1.9 2.2 1.9 3.3-1.9" fill="none" stroke="#F1ECDE" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  dashboard: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/></svg>`,
  pointage: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M9 12l2 2 4-4"/><rect x="3" y="4" width="18" height="17" rx="2"/><path d="M8 2v4M16 2v4"/></svg>`,
  membres: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="9" cy="8" r="3.2"/><path d="M2.5 20c0-4 3-6.5 6.5-6.5s6.5 2.5 6.5 6.5"/><circle cx="17.5" cy="8.5" r="2.5"/><path d="M15.5 13.3c2.8.3 5 2.6 5 6.2"/></svg>`,
  rapports: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M7 3h8l4 4v14a1 1 0 01-1 1H7a1 1 0 01-1-1V4a1 1 0 011-1z"/><path d="M9 12h6M9 16h6M9 8h3"/></svg>`,
  stamp: `<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" fill="#4F6B4D" stroke="#FFFFFF" stroke-width="1.5"/><path d="M8 12.5l2.5 2.5 5.5-6" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  upload: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 16v3a2 2 0 002 2h12a2 2 0 002-2v-3"/></svg>`,
  plus: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>`,
  download: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 4v12M7 11l5 5 5-5"/><path d="M4 19h16"/></svg>`,
  drive: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M8 3l8 0 5 9-4 7-9 0-5-8z"/><path d="M8 3l-5 9M16 3l5 9M4.5 13.5h15"/></svg>`,
  settings: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 00.3 1.9l.1.1-2.2 2.2-.1-.1a1.7 1.7 0 00-1.9-.3 1.7 1.7 0 00-1 1.6v.2h-3.2v-.2a1.7 1.7 0 00-1-1.6 1.7 1.7 0 00-1.9.3l-.1.1-2.2-2.2.1-.1a1.7 1.7 0 00.3-1.9 1.7 1.7 0 00-1.6-1H4.6v-3.2h.2a1.7 1.7 0 001.6-1 1.7 1.7 0 00-.3-1.9L6 7.8l2.2-2.2.1.1a1.7 1.7 0 001.9.3 1.7 1.7 0 001-1.6v-.2h3.2v.2a1.7 1.7 0 001 1.6 1.7 1.7 0 001.9-.3l.1-.1 2.2 2.2-.1.1a1.7 1.7 0 00-.3 1.9 1.7 1.7 0 001.6 1h.2V14h-.2a1.7 1.7 0 00-1.6 1z"/></svg>`,
  amphi: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M2 8l10-5 10 5-10 5-10-5z"/><path d="M6 10.5V16c0 1.5 2.7 3 6 3s6-1.5 6-3v-5.5"/><path d="M22 8v6"/></svg>`,
  observations: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z"/></svg>`,
};

export const AMPHI_TYPE_LABEL = {
  cours: 'Cours', td: 'TD', tp: 'TP', lien: 'Lien',
  devoir: 'Devoir',
  examen_normale: 'Examen (session normale)',
  examen_rattrapage: 'Examen (session rattrapage)',
};
// Types pour lesquels une correction optionnelle peut être jointe en plus
// du document principal.
export const AMPHI_TYPES_WITH_CORRECTION = ['td', 'devoir', 'examen_normale', 'examen_rattrapage'];

// Libellés d'affichage pour le niveau d'un document ('' = non spécifique).
export const NIVEAU_LABEL = { '': 'Général', L1: 'L1', L2: 'L2', L3: 'L3', M1: 'M1', M2: 'M2' };

export const PDF_LOGO_PNG = 'data:image/png;base64,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';

/* ---------- Générateurs d'identifiants et dates ---------- */
export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
export const todayISO = () => new Date().toISOString().slice(0, 10);
export const fmtDate = (iso) => new Date(iso + 'T00:00:00').toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
export const nowTime = () => new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
export const initials = (nom, prenom) => ((prenom ? prenom[0] : '') + (nom ? nom[0] : '')).toUpperCase();
export const escapeHtml = (s) => (s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const normKey = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();

/* ---------- Périodes (année / mois) ---------- */
export const MOIS_FR = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
export function sessionYear(dateStr) { return (dateStr || '').slice(0, 4); }
export function sessionMonth(dateStr) { return (dateStr || '').slice(0, 7); }
export function periodMatches(dateStr, period) {
  if (!period || period === 'toutes') return true;
  if (period.length === 7) return sessionMonth(dateStr) === period;
  return sessionYear(dateStr) === period;
}
export function monthLabel(ym) { const [y, m] = ym.split('-'); return MOIS_FR[parseInt(m, 10) - 1] + ' ' + y; }

/* ---------- Supabase (configuration) ----------
   À CONFIGURER : voir supabase-setup.sql pour créer les tables, puis
   collez ci-dessous l'URL et la clé "anon" de votre projet Supabase
   (Project Settings → API). Tant que ce n'est pas fait, l'app
   fonctionne normalement en local uniquement.
------------------------------------------------------------------- */
export const SUPABASE_URL = 'https://jqbnwdcxewoflwflqqfg.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_J9V41kIvkiYH8VFu0n81KQ_ne6tvzvk';
export function supabaseConfigured() { return !SUPABASE_URL.startsWith('VOTRE_') && !SUPABASE_ANON_KEY.startsWith('VOTRE_'); }

// Heuristique partagée pour distinguer un échec réseau (à mettre en file
// d'attente pour retenter plus tard) d'un échec "métier" (permission
// refusée, validation...) qu'il ne sert à rien de retenter automatiquement.
export function isNetworkError(e) {
  if (!navigator.onLine) return true;
  const msg = ((e && e.message) || '').toLowerCase();
  return msg.includes('failed to fetch') || msg.includes('network') || msg.includes('load failed') || msg.includes('econnrefused');
}
