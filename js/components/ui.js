// components/ui.js — Petits fragments HTML réutilisés par plusieurs vues
// (cartes de statistique, ligne vide, regroupement de séances par année).
import { escapeHtml, fmtDate } from '../config.js';

export function statCard(label, value, note, cls) {
  return `<div class="card stat-card ${cls}">
    <div class="stat-label">${label}</div>
    <div class="stat-value">${value}</div>
    <div class="stat-note">${note}</div>
  </div>`;
}

export function emptyRow(msg) { return `<div class="ledger-row" style="color:var(--ink-faint);font-size:13px;">${msg}</div>`; }

export function sessionOptionsByYear(sessions, selectedId) {
  const byYear = {};
  sessions.forEach(s => { const y = (s.date || '').slice(0, 4); (byYear[y] = byYear[y] || []).push(s); });
  return Object.keys(byYear).sort((a, b) => b.localeCompare(a)).map(y =>
    `<optgroup label="${y}">${byYear[y].map(s => `<option value="${s.id}" ${s.id === selectedId ? 'selected' : ''}>${fmtDate(s.date)} — ${escapeHtml(s.label)}</option>`).join('')}</optgroup>`
  ).join('');
}
