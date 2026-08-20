// views/observations.js — Journal d'observations d'une Section : le compte
// Visiteur (PF) et le CA de la Section peuvent y écrire, le super-admin
// peut tout lire et modérer. Pleinement intégré au modèle de données
// synchronisé de l'app (AppState.data.observations) — comme les membres ou
// le pointage, donc consultable ET modifiable hors ligne, avec envoi
// automatique à la reconnexion via le mécanisme de synchronisation général.
import { AppState, showToast, openConfirm } from '../state.js';
import { escapeHtml, fmtDate, uid } from '../config.js';
import { saveData } from '../db/data.js';
import { emptyRow } from '../components/ui.js';

const editingIds = new Set();

function roleLabel(role) {
  if (role === 'pf') return 'Visiteur (PF)';
  if (role === 'super_admin') return 'Super-admin';
  if (role === 'ca') return 'CA';
  return role || '—';
}

function sortedObservations() {
  return (AppState.data.observations || []).slice().sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
}

export function renderObservations() {
  const role = AppState.sbProfile?.role;
  const canWrite = role === 'pf' || role === 'ca' || role === 'super_admin';
  const observations = sortedObservations();
  return `<div class="page-head"><div><div class="eyebrow">Suivi</div><h1 class="page-title">Observations</h1><p class="page-sub">Espace d’échange entre le Visiteur (PF) et la Commission Administrative de cette Section — visible uniquement par son CA et le super-admin.</p></div></div>
    ${canWrite ? `<div class="card">
      <h3 class="card-title">Nouvelle observation</h3>
      <textarea id="newObservationText" placeholder="Écrire une observation…" style="width:100%;min-height:100px;padding:10px 12px;border:1px solid var(--line-strong);border-radius:var(--radius-sm);font-family:inherit;font-size:13.5px;resize:vertical;box-sizing:border-box;"></textarea>
      <button class="btn btn-primary" id="addObservationBtn" style="margin-top:10px;">Publier</button>
    </div>` : ''}
    <div class="card" style="margin-top:16px;">
      <h3 class="card-title">Journal</h3>
      <div class="card-sub">${observations.length} observation${observations.length > 1 ? 's' : ''}</div>
      ${renderObservationsList(observations)}
    </div>`;
}

function renderObservationsList(observations) {
  if (!observations.length) return emptyRow('Aucune observation pour l’instant.');
  return `<div class="ledger">${observations.map(o => {
    const isEditing = editingIds.has(o.id);
    const isMine = o.authorUserId === AppState.sbUser?.id;
    const canDelete = isMine || AppState.sbProfile?.role === 'super_admin';
    return `<div class="ledger-row" style="flex-direction:column;align-items:stretch;gap:6px;">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;flex-wrap:wrap;">
        <div>
          <span class="pill" style="background:var(--emerald-tint);border-color:var(--emerald);color:var(--emerald-dim);font-weight:700;">${escapeHtml(roleLabel(o.authorRole))}</span>
          <span style="font-weight:700;margin-left:6px;">${escapeHtml(o.authorName || 'Anonyme')}</span>
        </div>
        <div style="font-size:11px;color:var(--ink-faint);white-space:nowrap;">${fmtDate((o.createdAt || '').slice(0, 10))}${o.updatedAt && o.updatedAt !== o.createdAt ? ' · modifié' : ''}</div>
      </div>
      ${isEditing ? `
        <textarea class="observation-edit-textarea" data-id="${o.id}" style="width:100%;min-height:80px;padding:8px 10px;border:1px solid var(--line-strong);border-radius:var(--radius-sm);font-family:inherit;font-size:13.5px;box-sizing:border-box;">${escapeHtml(o.content)}</textarea>
        <div style="display:flex;gap:8px;">
          <button class="btn btn-primary btn-sm observation-save-btn" data-id="${o.id}">Enregistrer</button>
          <button class="btn btn-ghost btn-sm observation-cancel-btn" data-id="${o.id}">Annuler</button>
        </div>
      ` : `
        <div style="font-size:13.5px;color:var(--ink);white-space:pre-wrap;">${escapeHtml(o.content)}</div>
        ${(isMine || canDelete) ? `<div style="display:flex;gap:8px;">
          ${isMine ? `<button class="edit-name-btn observation-edit-btn" data-id="${o.id}">modifier</button>` : ''}
          ${canDelete ? `<button class="edit-name-btn observation-delete-btn" data-id="${o.id}" style="color:var(--terracotta);">supprimer</button>` : ''}
        </div>` : ''}
      `}
    </div>`;
  }).join('')}</div>`;
}

export function attachObservationsEvents() {
  const addBtn = document.getElementById('addObservationBtn');
  if (addBtn) addBtn.addEventListener('click', async () => {
    const textarea = document.getElementById('newObservationText');
    const content = textarea.value.trim();
    if (!content) { showToast('Écrivez une observation avant de publier'); return; }
    const now = new Date().toISOString();
    const obs = {
      id: uid(),
      authorUserId: AppState.sbUser.id,
      authorName: AppState.data.profile.name || AppState.sbProfile?.email || '',
      authorRole: AppState.sbProfile?.role || '',
      content,
      createdAt: now,
      updatedAt: now,
    };
    AppState.data.observations = AppState.data.observations || [];
    AppState.data.observations.push(obs);
    textarea.value = '';
    await saveData();
    showToast('Observation publiée');
    AppState.render();
  });

  document.querySelectorAll('.observation-edit-btn').forEach(btn => btn.addEventListener('click', () => {
    editingIds.add(btn.dataset.id);
    AppState.render();
  }));
  document.querySelectorAll('.observation-cancel-btn').forEach(btn => btn.addEventListener('click', () => {
    editingIds.delete(btn.dataset.id);
    AppState.render();
  }));
  document.querySelectorAll('.observation-save-btn').forEach(btn => btn.addEventListener('click', async () => {
    const id = btn.dataset.id;
    const textarea = document.querySelector(`.observation-edit-textarea[data-id="${id}"]`);
    const newContent = textarea.value.trim();
    if (!newContent) { showToast('Le contenu ne peut pas être vide'); return; }
    const obs = (AppState.data.observations || []).find(o => o.id === id);
    if (!obs) return;
    obs.content = newContent;
    obs.updatedAt = new Date().toISOString();
    editingIds.delete(id);
    await saveData();
    showToast('Observation modifiée');
    AppState.render();
  }));
  document.querySelectorAll('.observation-delete-btn').forEach(btn => btn.addEventListener('click', () => {
    openConfirm('Supprimer cette observation ?', 'Cette action est irréversible.', async () => {
      AppState.data.observations = (AppState.data.observations || []).filter(o => o.id !== btn.dataset.id);
      await saveData();
      showToast('Observation supprimée');
      AppState.render();
    }, 'Supprimer');
  }));
}
