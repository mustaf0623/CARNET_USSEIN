// views/administration.js — Onglet réservé au rôle super_admin : gestion des
// Sections et des comptes utilisateurs. Agit directement sur Supabase (données
// partagées entre Sections), jamais stockées en local.
//
// La liste des utilisateurs peut compter plusieurs centaines de comptes :
// elle est donc filtrable (recherche nom/email, rôle, Section, statut) et
// affichée par lots ("Afficher plus") plutôt que d'un seul bloc — ça évite
// à la fois une page interminable à faire défiler et de déclencher d'un
// coup des dizaines de requêtes réseau (chaque ligne "Utilisateur" charge
// la liste des membres de sa Section pour son sélecteur).
//
// Attribution du rôle "utilisateur" : ce rôle n'a de sens qu'accompagné d'un
// membre correspondant (matched_membre_id), utilisé pour dériver son
// UFR/Filière côté Amphithéâtre. L'attribution manuelle passe donc par la
// RPC `admin_assign_role`, qui exige ce membre et refuse sinon — impossible
// de reproduire côté client le bug d'un compte "utilisateur" sans membre lié.
import { AppState, showToast, openConfirm } from '../state.js';
import { escapeHtml, isPfRole } from '../config.js';
import { emptyRow } from '../components/ui.js';
import { loadAccessContext, pullFromSupabase, updateSnapshotsFromCurrent } from '../db/sync.js';

const USERS_PAGE_SIZE = 50;

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

function normSearch(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''); }

// Applique recherche + filtres (rôle, Section, statut) et trie
// alphabétiquement — bien plus facile à parcourir que l'ordre de création
// brut une fois qu'il y a beaucoup de comptes.
function filteredSbUsers() {
  const q = normSearch(AppState.adminUserSearch);
  return AppState.sbUsers
    .filter(u => {
      if (AppState.adminUserRoleFilter !== 'tous' && u.role !== AppState.adminUserRoleFilter) return false;
      if (AppState.adminUserSectionFilter !== 'toutes' && (u.section_id || '') !== AppState.adminUserSectionFilter) return false;
      if (AppState.adminUserActiveFilter === 'actifs' && u.active === false) return false;
      if (AppState.adminUserActiveFilter === 'inactifs' && u.active !== false) return false;
      if (q && !normSearch(`${u.name || ''} ${u.email || ''}`).includes(q)) return false;
      return true;
    })
    .sort((a, b) => (a.name || a.email || '').localeCompare(b.name || b.email || ''));
}

export function renderAdministration() {
  const sectionOptions = `<option value="">Aucune Section</option>` + AppState.sbSections.map(s => `<option value="${s.id}">${escapeHtml(s.nom)}</option>`).join('');
  const offlineNotice = !navigator.onLine ? `<div style="background:var(--terracotta-tint);border:1px solid var(--terracotta);color:var(--terracotta-dim);border-radius:var(--radius-sm);padding:10px 14px;font-size:12.5px;font-weight:600;margin-bottom:16px;">Hors ligne — la gestion des Sections et des utilisateurs nécessite une connexion internet.</div>` : '';

  const allFiltered = filteredSbUsers();
  const visible = allFiltered.slice(0, AppState.adminUserVisibleCount);
  const hasMore = allFiltered.length > visible.length;
  const sectionFilterOptions = `<option value="toutes" ${AppState.adminUserSectionFilter === 'toutes' ? 'selected' : ''}>Toutes les Sections</option>`
    + AppState.sbSections.map(s => `<option value="${s.id}" ${AppState.adminUserSectionFilter === s.id ? 'selected' : ''}>${escapeHtml(s.nom)}</option>`).join('');

  return `<div class="page-head"><div><div class="eyebrow">Super-administration</div><h1 class="page-title">Sections et utilisateurs</h1><p class="page-sub">Créez les Sections et attribuez les accès.</p></div></div>
    ${offlineNotice}
    <div class="grid grid-2"><div class="card"><h3 class="card-title">Nouvelle Section</h3><div style="display:flex;gap:8px;"><input id="newSectionName" placeholder="Nom de la Section"><button class="btn btn-primary" id="newSectionBtn">Créer</button></div><div class="ledger" style="margin-top:14px;">${AppState.sbSections.map(s => `<div class="admin-section-row" data-id="${s.id}"><input class="admin-section-name" data-id="${s.id}" value="${escapeHtml(s.nom)}" /><div class="admin-section-actions"><button class="btn btn-ghost btn-sm rename-section-btn" data-id="${s.id}">Renommer</button><button class="btn btn-ghost btn-sm delete-section-btn" data-id="${s.id}">Supprimer</button></div></div>`).join('') || emptyRow('Aucune Section.')}</div></div>
    <div class="card">
      <h3 class="card-title">Utilisateurs</h3>
      <div class="card-sub">${allFiltered.length} sur ${AppState.sbUsers.length} au total${allFiltered.length !== AppState.sbUsers.length ? ' (filtré)' : ''}</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px;">
        <input type="text" id="adminUserSearch" placeholder="Rechercher un nom ou un email…" value="${escapeHtml(AppState.adminUserSearch || '')}" style="flex:1;min-width:200px;">
        <select id="adminUserRoleFilter" style="min-width:170px;">
          <option value="tous" ${AppState.adminUserRoleFilter === 'tous' ? 'selected' : ''}>Tous les rôles</option>
          <option value="utilisateur" ${AppState.adminUserRoleFilter === 'utilisateur' ? 'selected' : ''}>Utilisateur (Amphithéâtre)</option>
          <option value="ca" ${AppState.adminUserRoleFilter === 'ca' ? 'selected' : ''}>CA</option>
          <option value="pf_section" ${AppState.adminUserRoleFilter === 'pf_section' ? 'selected' : ''}>PF de Section</option>
          <option value="pf_conseil" ${AppState.adminUserRoleFilter === 'pf_conseil' ? 'selected' : ''}>PF Conseil</option>
          <option value="super_admin" ${AppState.adminUserRoleFilter === 'super_admin' ? 'selected' : ''}>Super-admin</option>
        </select>
        <select id="adminUserSectionFilter" style="min-width:170px;">${sectionFilterOptions}</select>
        <select id="adminUserActiveFilter" style="min-width:130px;">
          <option value="tous" ${AppState.adminUserActiveFilter === 'tous' ? 'selected' : ''}>Actifs et inactifs</option>
          <option value="actifs" ${AppState.adminUserActiveFilter === 'actifs' ? 'selected' : ''}>Actifs seulement</option>
          <option value="inactifs" ${AppState.adminUserActiveFilter === 'inactifs' ? 'selected' : ''}>Inactifs seulement</option>
        </select>
      </div>
      <div class="ledger">${visible.map(u => {
        const isSelf = u.id === AppState.sbUser?.id;
        const isUtilisateur = u.role === 'utilisateur';
        const isPf = isPfRole(u.role);
        const showMembreSelect = isUtilisateur || isPf;
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
              <option value="pf_section" ${u.role === 'pf_section' ? 'selected' : ''}>PF de Section (lecture + pointage)</option>
              <option value="pf_conseil" ${u.role === 'pf_conseil' || u.role === 'pf' ? 'selected' : ''}>PF Conseil (lecture + pointage)</option>
              <option value="super_admin" ${u.role === 'super_admin' ? 'selected' : ''}>Super-admin</option>
            </select>
            <select class="admin-user-membre" data-id="${u.id}" data-current="${u.matched_membre_id || ''}" style="min-width:220px;${showMembreSelect ? '' : 'display:none;'}">
              <option value="">${isUtilisateur ? '— Choisir le membre correspondant —' : (isPf ? '— Aucun membre lié (facultatif) —' : '')}</option>
            </select>
            <label class="admin-user-active-label"><input class="admin-user-active" data-id="${u.id}" type="checkbox" ${u.active !== false ? 'checked' : ''} ${isSelf ? 'disabled' : ''}>actif</label>
            <button class="btn btn-ghost btn-sm save-user-btn" data-id="${u.id}">Enregistrer</button>
          </div>
        </div>`;
      }).join('') || emptyRow(AppState.sbUsers.length ? 'Aucun utilisateur ne correspond à ces filtres.' : 'Aucun utilisateur.')}</div>
      ${hasMore ? `<button class="btn btn-ghost btn-sm" id="adminUsersLoadMoreBtn" style="width:100%;justify-content:center;margin-top:12px;">Afficher plus (${allFiltered.length - visible.length} restants)</button>` : ''}
    </div></div>`;
}

// Remplit le sélecteur de membre d'une ligne avec les membres de la Section
// actuellement choisie dans cette même ligne, et présélectionne le membre
// déjà lié le cas échéant.
async function populateMembreSelect(row) {
  const membreSelect = row.querySelector('.admin-user-membre');
  const roleSelect = row.querySelector('.admin-user-role');
  const sectionId = row.querySelector('.admin-user-section').value;
  const current = membreSelect.dataset.current || '';
  const emptyLabel = roleSelect.value === 'utilisateur' ? '— Choisir le membre correspondant —' : '— Aucun membre lié (facultatif) —';
  membreSelect.innerHTML = `<option value="">Chargement…</option>`;
  const membres = await fetchMembresForSection(sectionId);
  membreSelect.innerHTML = `<option value="">${emptyLabel}</option>`
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

  // Recherche et filtres : chaque changement repart d'un premier lot
  // (adminUserVisibleCount réinitialisé), sinon le nombre de résultats
  // visibles resterait calé sur l'ancien filtre et pourrait tout masquer.
  const searchInput = document.getElementById('adminUserSearch');
  if (searchInput) searchInput.addEventListener('input', e => {
    AppState.adminUserSearch = e.target.value;
    AppState.adminUserVisibleCount = USERS_PAGE_SIZE;
    const pos = e.target.selectionStart;
    AppState.render();
    const again = document.getElementById('adminUserSearch');
    if (again) { again.focus(); again.setSelectionRange(pos, pos); }
  });
  const roleFilter = document.getElementById('adminUserRoleFilter');
  if (roleFilter) roleFilter.addEventListener('change', e => {
    AppState.adminUserRoleFilter = e.target.value;
    AppState.adminUserVisibleCount = USERS_PAGE_SIZE;
    AppState.render();
  });
  const sectionFilter = document.getElementById('adminUserSectionFilter');
  if (sectionFilter) sectionFilter.addEventListener('change', e => {
    AppState.adminUserSectionFilter = e.target.value;
    AppState.adminUserVisibleCount = USERS_PAGE_SIZE;
    AppState.render();
  });
  const activeFilter = document.getElementById('adminUserActiveFilter');
  if (activeFilter) activeFilter.addEventListener('change', e => {
    AppState.adminUserActiveFilter = e.target.value;
    AppState.adminUserVisibleCount = USERS_PAGE_SIZE;
    AppState.render();
  });
  const loadMoreBtn = document.getElementById('adminUsersLoadMoreBtn');
  if (loadMoreBtn) loadMoreBtn.addEventListener('click', () => {
    AppState.adminUserVisibleCount += USERS_PAGE_SIZE;
    AppState.render();
  });

  // Basculer l'affichage du sélecteur de membre selon le rôle choisi, et le
  // Basculer l'affichage du sélecteur de membre selon le rôle choisi (pour
  // "utilisateur" ET "pf"), et le repeupler si la Section change pendant
  // que l'un de ces deux rôles est actif.
  document.querySelectorAll('.admin-user-row').forEach(row => {
    const roleSelect = row.querySelector('.admin-user-role');
    const sectionSelect = row.querySelector('.admin-user-section');
    const membreSelect = row.querySelector('.admin-user-membre');
    const needsMembreSelect = () => roleSelect.value === 'utilisateur' || isPfRole(roleSelect.value);
    const syncMembreVisibility = () => {
      if (needsMembreSelect()) {
        membreSelect.style.display = '';
        populateMembreSelect(row);
      } else {
        membreSelect.style.display = 'none';
      }
    };
    roleSelect.addEventListener('change', syncMembreVisibility);
    sectionSelect.addEventListener('change', () => { if (needsMembreSelect()) populateMembreSelect(row); });
    if (needsMembreSelect()) populateMembreSelect(row);
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
