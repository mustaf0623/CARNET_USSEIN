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

// Variante pour deux valeurs à afficher côte à côte dans la même carte
// (ex. Hommes / Femmes) : chiffres alignés sur une même ligne de base,
// chacun avec son propre libellé, séparés par un fin trait vertical —
// plus lisible que la fusion en texte brut "12 / 8".
export function statCardSplit(label, leftLabel, leftValue, rightLabel, rightValue, note, cls) {
  return `<div class="card stat-card ${cls}">
    <div class="stat-label">${label}</div>
    <div class="stat-value-split">
      <div class="stat-value-split-item">
        <span class="stat-value-split-num">${leftValue}</span>
        <span class="stat-value-split-label">${leftLabel}</span>
      </div>
      <div class="stat-value-split-divider"></div>
      <div class="stat-value-split-item">
        <span class="stat-value-split-num">${rightValue}</span>
        <span class="stat-value-split-label">${rightLabel}</span>
      </div>
    </div>
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
