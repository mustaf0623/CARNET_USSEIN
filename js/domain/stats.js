// domain/stats.js — Calculs statistiques purs à partir des données de présence.
// Toutes ces fonctions prennent `data` en paramètre et ne touchent jamais au
// DOM ni à AppState : elles sont testables indépendamment de l'UI.

import { sessionYear, sessionMonth, periodMatches, monthLabel } from '../config.js';
import { memberInProgramme, isSortant } from './membres.js';

export { sessionYear, sessionMonth, periodMatches, monthLabel };

export function getAvailableMonths(data, progId) {
  const sessions = progId && progId !== 'global' ? data.sessions.filter(s => s.programmeId === progId) : data.sessions;
  const set = new Set(sessions.map(s => sessionMonth(s.date)));
  return Array.from(set).filter(Boolean).sort((a, b) => b.localeCompare(a));
}

export function getAvailableYears(data) {
  const set = new Set(data.sessions.map(s => sessionYear(s.date)));
  return Array.from(set).filter(Boolean).sort((a, b) => b.localeCompare(a));
}

export function memberStats(data, membreId, yearFilter) {
  yearFilter = yearFilter || 'toutes';
  const m = data.membres.find(x => x.id === membreId);
  const parProgramme = [];
  let totalPresent = 0, totalAbsent = 0;
  data.programmes.forEach(p => {
    if (!m || !memberInProgramme(m, p.id)) return;
    let sessions = data.sessions.filter(s => s.programmeId === p.id);
    if (yearFilter !== 'toutes') sessions = sessions.filter(s => periodMatches(s.date, yearFilter));
    const sessionIds = sessions.map(s => s.id);
    const pts = data.pointages.filter(pt => pt.membreId === membreId && sessionIds.includes(pt.sessionId));
    const present = pts.filter(pt => pt.statut === 'present').length;
    const absent = pts.filter(pt => pt.statut === 'absent').length;
    const total = present + absent;
    totalPresent += present; totalAbsent += absent;
    parProgramme.push({
      programmeId: p.id, nom: p.nom, nbSeancesProgramme: sessions.length,
      present, absent, total, tauxPresence: total ? Math.round((present / total) * 100) : 0,
    });
  });
  const totalAll = totalPresent + totalAbsent;
  return {
    parProgramme,
    overall: { present: totalPresent, absent: totalAbsent, total: totalAll, tauxPresence: totalAll ? Math.round((totalPresent / totalAll) * 100) : 0 },
  };
}

export function programStats(data, progId, yearFilter) {
  yearFilter = yearFilter || 'toutes';
  const sessions = data.sessions.filter(s => s.programmeId === progId && periodMatches(s.date, yearFilter));
  const sessionIds = sessions.map(s => s.id);
  const pts = data.pointages.filter(p => sessionIds.includes(p.sessionId));
  const present = pts.filter(p => p.statut === 'present').length;
  const total = pts.length;
  const tauxPresence = total ? Math.round((present / total) * 100) : 0;
  const membresInscrits = data.membres.filter(m => !m.ap && !isSortant(m) && memberInProgramme(m, progId));
  const membresPresentsUneFois = new Set(pts.filter(p => p.statut === 'present').map(p => p.membreId));
  const tauxParticipation = membresInscrits.length ? Math.round((membresPresentsUneFois.size / membresInscrits.length) * 100) : 0;
  return { tauxPresence, tauxAbsence: 100 - tauxPresence, tauxParticipation, nbSessions: sessions.length, nbMembres: membresInscrits.length, present, total };
}

// Série d'absences consécutives la plus récente d'un membre sur un programme
// (une présence remet la série à zéro ; une séance non pointée pour ce
// membre est ignorée — elle ne casse ni ne compte dans la série).
export function consecutiveAbsenceStreak(data, membreId, progId) {
  const sessions = data.sessions.filter(s => s.programmeId === progId).sort((a, b) => a.date.localeCompare(b.date));
  let streak = 0;
  let lastDate = null;
  sessions.forEach(s => {
    const pt = data.pointages.find(p => p.sessionId === s.id && p.membreId === membreId);
    if (!pt) return;
    if (pt.statut === 'absent') { streak++; lastDate = s.date; }
    else { streak = 0; lastDate = null; }
  });
  return { streak, lastDate };
}

// Répertoire des membres permanents (non "Ponctuel/AP") ayant `seuil` absences
// consécutives ou plus sur au moins un programme.
export function absenceWatchlist(data, seuil) {
  seuil = seuil || 3;
  const rows = [];
  data.membres.filter(m => !m.ap && !isSortant(m)).forEach(m => {
    data.programmes.forEach(p => {
      if (!memberInProgramme(m, p.id)) return;
      const { streak, lastDate } = consecutiveAbsenceStreak(data, m.id, p.id);
      if (streak >= seuil) rows.push({ membre: m, programme: p, streak, lastDate });
    });
  });
  rows.sort((a, b) => b.streak - a.streak);
  return rows;
}

export function sessionStats(data, sessionId) {
  const pts = data.pointages.filter(p => p.sessionId === sessionId);
  const present = pts.filter(p => p.statut === 'present').length;
  const total = pts.length;
  return { present, total, tauxPresence: total ? Math.round((present / total) * 100) : 0 };
}

// Statistiques globales, filtrables par programme ('global' = tous) et par année ('toutes' = toutes)
export function scopedStats(data, progFilter, yearFilter) {
  yearFilter = yearFilter || 'toutes';
  const membres = (progFilter === 'global' ? data.membres : data.membres.filter(m => memberInProgramme(m, progFilter))).filter(m => !m.ap && !isSortant(m));
  const nbH = membres.filter(m => m.sexe === 'H').length;
  const nbF = membres.filter(m => m.sexe === 'F').length;
  const total = membres.length;
  let sessions = progFilter === 'global' ? data.sessions : data.sessions.filter(s => s.programmeId === progFilter);
  if (yearFilter !== 'toutes') sessions = sessions.filter(s => periodMatches(s.date, yearFilter));
  const sessionIds = sessions.map(s => s.id);
  const pts = data.pointages.filter(p => sessionIds.includes(p.sessionId));
  const present = pts.filter(p => p.statut === 'present').length;
  const tauxPresence = pts.length ? Math.round((present / pts.length) * 100) : 0;
  return { nbH, nbF, total, tauxPresence, tauxAbsence: 100 - tauxPresence };
}
