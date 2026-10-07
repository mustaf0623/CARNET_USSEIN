// components/modals.js — Fenêtres modales transverses, utilisées par
// plusieurs vues : confirmation générique, renommage du signataire, fiche
// détaillée d'un membre, complétion d'informations après promotion AP.

import { AppState, showToast, openConfirm } from '../state.js';
import { escapeHtml, initials, ICONS, todayISO } from '../config.js';
import { saveData } from '../db/data.js';
import { memberStats, getAvailableYears } from '../domain/stats.js';
import { extraFieldKeys, isSortant, SORTANT_GRACE_DAYS } from '../domain/membres.js';
import { statCard, emptyRow } from './ui.js';

/* ================= Confirmation générique ================= */
export function renderConfirmModal() {
  return `
  <div class="onboard-overlay" id="confirmOverlay">
    <div class="onboard-card">
      <div class="onboard-mark" style="background:linear-gradient(155deg, var(--terracotta), var(--terracotta-dim));box-shadow:0 10px 24px -8px rgba(225,95,30,0.5);">
        <svg viewBox="0 0 24 24" fill="none" stroke="#FFF5EE" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2m2 0v13a1 1 0 01-1 1H8a1 1 0 01-1-1V7h10z"/></svg>
      </div>
      <h2>${escapeHtml(AppState.confirmTitle)}</h2>
      <p>${escapeHtml(AppState.confirmMessage)}</p>
      <button class="btn" id="confirmYesBtn" style="width:100%;justify-content:center;margin-bottom:10px;background:var(--terracotta);border-color:transparent;color:#fff;">${escapeHtml(AppState.confirmLabel)}</button>
      <button class="btn btn-ghost" id="confirmNoBtn" style="width:100%;justify-content:center;">Annuler</button>
    </div>
  </div>`;
}
export function attachConfirmModal() {
  document.getElementById('confirmYesBtn').addEventListener('click', () => {
    const action = AppState.pendingConfirmAction;
    AppState.confirmModalOpen = false;
    AppState.pendingConfirmAction = null;
    if (action) action();
  });
  document.getElementById('confirmNoBtn').addEventListener('click', () => { AppState.confirmModalOpen = false; AppState.pendingConfirmAction = null; AppState.render(); });
  document.getElementById('confirmOverlay').addEventListener('click', (e) => { if (e.target.id === 'confirmOverlay') { AppState.confirmModalOpen = false; AppState.pendingConfirmAction = null; AppState.render(); } });
}

/* ================= Renommage du signataire ================= */
export function renameSignataire() {
  AppState.renameModalOpen = true;
  AppState.render();
}
export function renderRenameModal() {
  return `
  <div class="onboard-overlay" id="renameOverlay">
    <div class="onboard-card">
      <div class="onboard-mark">${ICONS.mark}</div>
      <h2>Changer le signataire</h2>
      <p>Ce nom apparaîtra sur les prochains rapports générés.</p>
      <input type="text" id="renameInput" placeholder="Nom complet" value="${escapeHtml(AppState.data.profile.name)}" autofocus />
      <button class="btn btn-primary" id="renameSaveBtn" style="width:100%;justify-content:center;margin-bottom:10px;">Enregistrer</button>
      <button class="btn btn-ghost" id="renameCancelBtn" style="width:100%;justify-content:center;">Annuler</button>
    </div>
  </div>`;
}
export function attachRenameModal() {
  const save = async () => {
    const v = document.getElementById('renameInput').value.trim();
    if (!v) { showToast('Merci de renseigner un nom'); return; }
    AppState.data.profile.name = v;
    AppState.renameModalOpen = false;
    await saveData();
    AppState.render();
  };
  document.getElementById('renameSaveBtn').addEventListener('click', save);
  document.getElementById('renameInput').addEventListener('keydown', e => { if (e.key === 'Enter') save(); });
  document.getElementById('renameCancelBtn').addEventListener('click', () => { AppState.renameModalOpen = false; AppState.render(); });
  document.getElementById('renameOverlay').addEventListener('click', (e) => { if (e.target.id === 'renameOverlay') { AppState.renameModalOpen = false; AppState.render(); } });
}

/* ================= Fiche détaillée d'un membre ================= */
export function renderMemberDetailModal() {
  const d = AppState.data;
  const m = d.membres.find(x => x.id === AppState.memberDetailId);
  if (!m) return '';
  const yearFilter = AppState.dashYearFilter || 'toutes';
  const years = getAvailableYears(d);
  const yearOptions = [`<option value="toutes" ${yearFilter === 'toutes' ? 'selected' : ''}>Toutes années</option>`].concat(
    years.map(y => `<option value="${y}" ${yearFilter === y ? 'selected' : ''}>${y}</option>`)
  ).join('');
  const stats = memberStats(d, m.id, yearFilter);
  return `
  <div class="onboard-overlay" id="memberDetailOverlay">
    <button id="memberDetailCloseFixedBtn" title="Fermer" style="position:fixed;top:16px;right:16px;z-index:200;width:36px;height:36px;border-radius:50%;border:1px solid rgba(237,241,229,0.3);background:rgba(18,35,24,0.75);backdrop-filter:blur(4px);color:#fff;font-size:18px;line-height:1;cursor:pointer;">×</button>
    <div class="onboard-card" style="width:min(480px, 92vw);text-align:left;">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:6px;">
        <div class="avatar" style="width:44px;height:44px;font-size:16px;">${initials(m.nom, m.prenom)}</div>
        <div>
          <h2 style="margin:0;">${escapeHtml(m.prenom)} ${escapeHtml(m.nom)}</h2>
          <div style="font-size:12.5px;color:var(--ink-faint);">${m.sexe === 'H' ? 'Homme' : 'Femme'}${m.allProgrammes ? ' · Tous les programmes' : ''}</div>
        </div>
        <select id="memberDetailYear" style="margin-left:auto;min-width:130px;">${yearOptions}</select>
      </div>
      <div class="grid grid-4" style="margin:16px 0;gap:10px;">
        ${statCard('Séances', stats.overall.total, 'pointées', 'stat-gold')}
        ${statCard('Présences', stats.overall.present, '', 'stat-emerald')}
        ${statCard('Absences', stats.overall.absent, '', 'stat-terracotta')}
        ${statCard('Taux', stats.overall.tauxPresence + '%', 'présence globale', 'stat-emerald')}
      </div>
      <div class="card-title" style="font-size:14px;margin-bottom:8px;">Détail par programme</div>
      <div class="ledger" style="max-height:260px;overflow-y:auto;">
        ${stats.parProgramme.length ? stats.parProgramme.map(s => `
          <div class="ledger-row">
            <div class="prog-name">${escapeHtml(s.nom)}</div>
            <div class="prog-bar-wrap"><div class="prog-bar-fill" style="width:${s.tauxPresence}%"></div></div>
            <div class="prog-pct">${s.tauxPresence}%</div>
          </div>
          <div style="font-size:11.5px;color:var(--ink-faint);margin:-8px 0 4px 0;padding-left:2px;">${s.present} présence${s.present > 1 ? 's' : ''} · ${s.absent} absence${s.absent > 1 ? 's' : ''} · ${s.nbSeancesProgramme} séance${s.nbSeancesProgramme > 1 ? 's' : ''} au programme</div>
        `).join('') : emptyRow('Aucun programme pour ce membre.')}
      </div>
      <div class="card-title" style="font-size:14px;margin:16px 0 8px;display:flex;align-items:center;justify-content:space-between;">
        <span>Informations importées</span>
        <button class="btn btn-ghost btn-sm" id="extraInfoAddFieldBtn" type="button">+ champ</button>
      </div>
      <div class="extra-info-grid" id="extraInfoGrid">
        ${Object.entries(m.extra || {}).map(([k, v]) => `<div class="extra-info-item" data-key="${escapeHtml(k)}">
          <label>${escapeHtml(k)}</label>
          <div class="extra-info-row">
            <input type="text" class="extraInfoValueInput" value="${escapeHtml(String(v))}">
            <button type="button" class="extra-info-remove" title="Supprimer ce champ">×</button>
          </div>
        </div>`).join('') || `<div style="font-size:12px;color:var(--ink-faint);grid-column:1/-1;">Aucune information importée pour ce membre.</div>`}
      </div>
      <button class="btn btn-primary btn-sm" id="extraInfoSaveBtn" type="button" style="width:100%;justify-content:center;margin-top:10px;">Enregistrer ces informations</button>
      <button class="btn btn-ghost" id="memberDetailCloseBtn" style="width:100%;justify-content:center;margin-top:16px;">Fermer</button>
    </div>
  </div>`;
}
export function attachMemberDetailModal() {
  document.getElementById('memberDetailCloseBtn').addEventListener('click', () => { AppState.memberDetailId = null; AppState.render(); });
  document.getElementById('memberDetailCloseFixedBtn')?.addEventListener('click', () => { AppState.memberDetailId = null; AppState.render(); });
  document.getElementById('memberDetailOverlay').addEventListener('click', (e) => { if (e.target.id === 'memberDetailOverlay') { AppState.memberDetailId = null; AppState.render(); } });
  const yearSel = document.getElementById('memberDetailYear');
  if (yearSel) yearSel.addEventListener('change', e => { AppState.dashYearFilter = e.target.value; AppState.render(); });

  const grid = document.getElementById('extraInfoGrid');
  if (grid) grid.addEventListener('click', e => {
    const removeBtn = e.target.closest('.extra-info-remove');
    if (removeBtn) removeBtn.closest('.extra-info-item')?.remove();
  });
  const addFieldBtn = document.getElementById('extraInfoAddFieldBtn');
  if (addFieldBtn) addFieldBtn.addEventListener('click', () => {
    const placeholder = grid.querySelector('div[style*="grid-column"]');
    if (placeholder) placeholder.remove();
    const item = document.createElement('div');
    item.className = 'extra-info-item';
    item.dataset.key = '';
    item.innerHTML = `<input type="text" class="extraInfoKeyInput" placeholder="Nom du champ" style="font-size:10.5px;font-weight:700;padding:4px 6px;margin-bottom:3px;border:1px solid var(--line);border-radius:6px;background:var(--card);color:var(--ink-faint);width:100%;box-sizing:border-box;"><div class="extra-info-row"><input type="text" class="extraInfoValueInput" placeholder="Valeur"><button type="button" class="extra-info-remove" title="Supprimer ce champ">×</button></div>`;
    grid.prepend(item);
    item.querySelector('.extraInfoKeyInput').focus();
  });
  const saveBtn = document.getElementById('extraInfoSaveBtn');
  if (saveBtn) saveBtn.addEventListener('click', () => {
    const m = AppState.data.membres.find(x => x.id === AppState.memberDetailId);
    if (!m) return;
    const extra = {};
    grid.querySelectorAll('.extra-info-item').forEach(item => {
      const keyInput = item.querySelector('.extraInfoKeyInput');
      const key = keyInput ? keyInput.value.trim() : item.dataset.key;
      const v = item.querySelector('.extraInfoValueInput').value.trim();
      if (key && v) extra[key] = v;
    });

    // Passage au statut "Sortant" : impact durable (exclusion des
    // statistiques/rapports, coupure d'accès au bout de 7 jours pour un
    // compte lié) — on ne l'applique jamais silencieusement.
    const wasSortant = isSortant(m);
    const willBeSortant = isSortant({ extra });
    const applyChange = async () => {
      m.extra = extra;
      if (!wasSortant && willBeSortant) m.sortantSince = todayISO();
      else if (wasSortant && !willBeSortant) m.sortantSince = null;
      await saveData();
      if (!wasSortant && willBeSortant) {
        showToast(`${m.prenom} ${m.nom} déplacé(e) vers les Sortants`);
        AppState.memberDetailId = null;
      } else {
        showToast('Informations enregistrées');
      }
      AppState.render();
    };

    if (!wasSortant && willBeSortant) {
      openConfirm(
        'Marquer ce membre comme Sortant ?',
        `${m.prenom} ${m.nom} sera déplacé vers l’onglet Sortants : exclu(e) des statistiques, du tableau de bord, des rapports et des exports. S’il/elle a un compte lié, l’accès à l’app sera coupé dans ${SORTANT_GRACE_DAYS} jours. Réversible en modifiant à nouveau le niveau d’étude.`,
        applyChange,
        'Confirmer'
      );
    } else {
      applyChange();
    }
  });
}

/* ================= Complétion d'infos après promotion AP → permanent ================= */
export function renderCompleteInfoModal() {
  const d = AppState.data;
  const id = AppState.completeInfoQueue[0];
  const m = d.membres.find(x => x.id === id);
  if (!m) { AppState.completeInfoQueue.shift(); return ''; }
  const keys = extraFieldKeys(d).filter(k => k !== 'Contact');
  return `
  <div class="onboard-overlay" id="completeInfoOverlay">
    <div class="onboard-card" style="width:min(440px, 92vw);text-align:left;">
      <h2 style="margin:0 0 4px;">${escapeHtml(m.prenom)} ${escapeHtml(m.nom)}</h2>
      <p style="margin:0 0 16px;font-size:13px;color:var(--ink-faint);">Intégré(e) définitivement à la base des membres permanents. Complétez ses informations pour qu’elles soient en phase avec le reste de la base.</p>
      <div class="extra-info-grid" style="margin-bottom:6px;">
        ${keys.length ? keys.map(k => `<div class="extra-info-item"><label>${escapeHtml(k)}</label><div class="extra-info-row"><input type="text" class="completeInfoInput" data-key="${escapeHtml(k)}" value="${escapeHtml(m.extra && m.extra[k] || '')}"></div></div>`).join('')
        : `<div style="font-size:12.5px;color:var(--ink-faint);grid-column:1/-1;">Aucun champ complémentaire détecté dans la base pour l’instant.</div>`}
      </div>
      <div style="display:flex;gap:10px;margin-top:14px;">
        <button class="btn btn-primary" id="completeInfoSaveBtn" style="flex:1;justify-content:center;">Enregistrer</button>
        <button class="btn btn-ghost" id="completeInfoSkipBtn" style="flex:1;justify-content:center;">Plus tard</button>
      </div>
    </div>
  </div>`;
}
export function attachCompleteInfoModal() {
  const id = AppState.completeInfoQueue[0];
  const advance = () => { AppState.completeInfoQueue.shift(); AppState.render(); };
  const save = document.getElementById('completeInfoSaveBtn');
  if (save) save.addEventListener('click', async () => {
    const m = AppState.data.membres.find(x => x.id === id);
    if (m) {
      m.extra = m.extra || {};
      document.querySelectorAll('.completeInfoInput').forEach(inp => {
        const v = inp.value.trim();
        if (v) m.extra[inp.dataset.key] = v;
      });
      await saveData();
    }
    advance();
  });
  const skip = document.getElementById('completeInfoSkipBtn');
  if (skip) skip.addEventListener('click', advance);
}
