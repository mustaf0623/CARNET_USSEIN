// views/administration.js — Onglet réservé au rôle super_admin : gestion des
// Sections et des comptes utilisateurs. Agit directement sur Supabase (données
// partagées entre Sections), jamais stockées en local.
//
// Attribution du rôle "utilisateur" : ce rôle n'a de sens qu'accompagné d'un
// membre correspondant (matched_membre_id), utilisé pour dériver son
// UFR/Filière côté Amphithéâtre. L'attribution manuelle passe donc par la
// RPC `admin_assign_role`, qui exige ce membre et refuse sinon — impossible
// de reproduire côté client le bug d'un compte "utilisateur" sans membre lié.
import { AppState, showToast, openConfirm } from '../state.js';
import { escapeHtml } from '../config.js';
import { emptyRow } from '../components/ui.js';
import { loadAccessContext, pullFromSupabase, updateSnapshotsFromCurrent } from '../db/sync.js';

// Cache des membres par Section (id -> [{id, nom, prenom}]), pour peupler le
// sélecteur sans refaire une requête à chaque interaction.
const membresParSection = new Map();
async function fetchMembresForSection(sectionId) {
  if (!sectionId) return [];
  if (membresParSection.has(sectionId)) return membresParSection.get(sectionId);
  const sb = AppState.sb;
  const { data, error } = await sb.from('membres').select('id, nom, prenom').eq('section_id', sectionId).order('nom');
  const list = error ? [] : (data || []);
  membresParSection.set(sectionId, list);
  return list;
}

export function renderAdministration() {
  const sectionOptions = `<option value="">Aucune Section</option>` + AppState.sbSections.map(s => `<option value="${s.id}">${escapeHtml(s.nom)}</option>`).join('');
  const offlineNotice = !navigator.onLine ? `<div style="background:var(--terracotta-tint);border:1px solid var(--terracotta);color:var(--terracotta-dim);border-radius:var(--radius-sm);padding:10px 14px;font-size:12.5px;font-weight:600;margin-bottom:16px;">Hors ligne — la gestion des Sections et des utilisateurs nécessite une connexion internet.</div>` : '';
  return `<div class="page-head"><div><div class="eyebrow">Super-administration</div><h1 class="page-title">Sections et utilisateurs</h1><p class="page-sub">Créez les Sections et attribuez les accès.</p></div></div>
    ${offlineNotice}
    <div class="grid grid-2"><div class="card"><h3 class="card-title">Nouvelle Section</h3><div style="display:flex;gap:8px;"><input id="newSectionName" placeholder="Nom de la Section"><button class="btn btn-primary" id="newSectionBtn">Créer</button></div><div class="ledger" style="margin-top:14px;">${AppState.sbSections.map(s => `<div class="admin-section-row" data-id="${s.id}"><input class="admin-section-name" data-id="${s.id}" value="${escapeHtml(s.nom)}" /><div class="admin-section-actions"><button class="btn btn-ghost btn-sm rename-section-btn" data-id="${s.id}">Renommer</button><button class="btn btn-ghost btn-sm delete-section-btn" data-id="${s.id}">Supprimer</button></div></div>`).join('') || emptyRow('Aucune Section.')}</div></div>
    <div class="card"><h3 class="card-title">Utilisateurs</h3><div class="ledger">${AppState.sbUsers.map(u => {
      const isSelf = u.id === AppState.sbUser?.id;
      const isUtilisateur = u.role === 'utilisateur';
      return `<div class="admin-user-row" data-id="${u.id}">
        <div class="admin-user-identity">
          <div class="prog-name">${escapeHtml(u.name || 'Sans nom')}${isSelf ? ' <span style="font-weight:400;color:var(--ink-faint);">(vous)</span>' : ''}</div>
          <div class="admin-user-email">${escapeHtml(u.email || u.id)}</div>
          ${isSelf ? `<div style="font-size:11px;color:var(--ink-faint);margin-top:2px;">Rôle et statut modifiables uniquement par un autre super-admin</div>` : ''}
        </div>
        <div class="admin-user-controls">
          <select class="admin-user-section" data-id="${u.id}">${sectionOptions.replace(`value="${u.section_id}"`, `value="${u.section_id}" selected`)}</select>
          <select class="admin-user-role" data-id="${u.id}" ${isSelf ? 'disabled' : ''}>
            <option value="utilisateur" ${u.role === 'utilisateur' ? 'selected' : ''}>Utilisateur (Amphithéâtre)</option>
            <option value="ca" ${u.role === 'ca' ? 'selected' : ''}>CA</option>
            <option value="pf" ${u.role === 'pf' ? 'selected' : ''}>Visiteur (PF — lecture seule)</option>
            <option value="super_admin" ${u.role === 'super_admin' ? 'selected' : ''}>Super-admin</option>
          </select>
          <select class="admin-user-membre" data-id="${u.id}" data-current="${u.matched_membre_id || ''}" style="min-width:220px;${isUtilisateur ? '' : 'display:none;'}">
            <option value="">${isUtilisateur ? '— Choisir le membre correspondant —' : ''}</option>
          </select>
          <label class="admin-user-active-label"><input class="admin-user-active" data-id="${u.id}" type="checkbox" ${u.active !== false ? 'checked' : ''} ${isSelf ? 'disabled' : ''}>actif</label>
          <button class="btn btn-ghost btn-sm save-user-btn" data-id="${u.id}">Enregistrer</button>
        </div>
      </div>`;
    }).join('') || emptyRow('Aucun utilisateur.')}</div></div></div>`;
}

// Remplit le sélecteur de membre d'une ligne avec les membres de la Section
// actuellement choisie dans cette même ligne, et présélectionne le membre
// déjà lié le cas échéant.
async function populateMembreSelect(row) {
  const membreSelect = row.querySelector('.admin-user-membre');
  const sectionId = row.querySelector('.admin-user-section').value;
  const current = membreSelect.dataset.current || '';
  membreSelect.innerHTML = `<option value="">Chargement…</option>`;
  const membres = await fetchMembresForSection(sectionId);
  membreSelect.innerHTML = `<option value="">— Choisir le membre correspondant —</option>`
    + membres.map(m => `<option value="${m.id}" ${m.id === current ? 'selected' : ''}>${escapeHtml(m.prenom)} ${escapeHtml(m.nom)}</option>`).join('');
  if (!membres.length) membreSelect.innerHTML = `<option value="">Aucun membre importé dans cette Section</option>`;
}

export function attachAdministrationEvents() {
  const sb = AppState.sb;
  // Le panneau Administration agit directement sur Supabase (données
  // partagées entre Sections, jamais stockées en local) : hors ligne, le
  // fetch rejette la promesse et remonte un TypeError brut ("Load failed").
  // On l'attrape partout pour afficher un message clair à la place.
  const runOrExplain = async fn => {
    try { await fn(); }
    catch (e) {
      console.error('Carnet — administration hors ligne:', e);
      showToast('Action impossible hors ligne — reconnectez-vous à internet et réessayez');
    }
  };
  const create = document.getElementById('newSectionBtn');
  if (create) create.addEventListener('click', () => runOrExplain(async () => {
    const nom = document.getElementById('newSectionName').value.trim();
    if (!nom) { showToast('Indiquez le nom de la Section'); return; }
    const { error } = await sb.from('sections').insert({ nom });
    if (error) { showToast(error.message); return; }
    await loadAccessContext(); AppState.render();
  }));
  document.querySelectorAll('.rename-section-btn').forEach(btn => btn.addEventListener('click', () => runOrExplain(async () => {
    const id = btn.dataset.id;
    const nom = document.querySelector(`.admin-section-name[data-id="${id}"]`).value.trim();
    if (!nom) { showToast('Le nom de la Section ne peut pas être vide'); return; }
    const { error } = await sb.from('sections').update({ nom }).eq('id', id);
    if (error) { showToast(error.message); return; }
    await loadAccessContext(); showToast('Section renommée'); AppState.render();
  })));
  document.querySelectorAll('.delete-section-btn').forEach(btn => btn.addEventListener('click', () => {
    const id = btn.dataset.id;
    const nom = (AppState.sbSections.find(s => s.id === id) || {}).nom || 'cette Section';
    openConfirm(
      'Supprimer cette Section ?',
      `Tous les programmes, membres, séances et pointages de « ${nom} » seront définitivement supprimés. Cette action est irréversible.`,
      () => runOrExplain(async () => {
        const { error } = await sb.from('sections').delete().eq('id', id);
        if (error) { showToast(error.message); return; }
        if (AppState.activeSectionId === id) AppState.activeSectionId = null;
        await loadAccessContext();
        AppState.data = await pullFromSupabase();
        updateSnapshotsFromCurrent();
        showToast('Section supprimée'); AppState.render();
      }),
      'Supprimer'
    );
  }));

  // Basculer l'affichage du sélecteur de membre selon le rôle choisi, et le
  // repeupler si la Section change pendant que le rôle "utilisateur" est actif.
  document.querySelectorAll('.admin-user-row').forEach(row => {
    const roleSelect = row.querySelector('.admin-user-role');
    const sectionSelect = row.querySelector('.admin-user-section');
    const membreSelect = row.querySelector('.admin-user-membre');
    const syncMembreVisibility = () => {
      if (roleSelect.value === 'utilisateur') {
        membreSelect.style.display = '';
        populateMembreSelect(row);
      } else {
        membreSelect.style.display = 'none';
      }
    };
    roleSelect.addEventListener('change', syncMembreVisibility);
    sectionSelect.addEventListener('change', () => { if (roleSelect.value === 'utilisateur') populateMembreSelect(row); });
    if (roleSelect.value === 'utilisateur') populateMembreSelect(row);
  });

  document.querySelectorAll('.save-user-btn').forEach(btn => btn.addEventListener('click', () => runOrExplain(async () => {
    const id = btn.dataset.id;
    const row = btn.closest('.admin-user-row');
    const section_id = row.querySelector('.admin-user-section').value || null;
    const role = row.querySelector('.admin-user-role').value;
    const active = row.querySelector('.admin-user-active').checked;
    const matched_membre_id = row.querySelector('.admin-user-membre').value || null;
    if (role === 'utilisateur' && !matched_membre_id) {
      showToast('Choisissez le membre correspondant pour le rôle Utilisateur');
      return;
    }
    const { error } = await sb.rpc('admin_assign_role', {
      target_user_id: id,
      new_role: role,
      new_section_id: section_id,
      new_active: active,
      new_matched_membre_id: matched_membre_id,
    });
    if (error) { showToast(error.message); return; }
    await loadAccessContext(); showToast('Utilisateur mis à jour'); AppState.render();
  })));
}
