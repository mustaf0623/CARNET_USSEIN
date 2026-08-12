// views/shell.js — Rendu racine de l'application : barre latérale, routeur
// d'onglets, écran d'onboarding et écran "accès en attente". C'est le seul
// module qui orchestre l'ensemble des vues — main.js l'appelle après avoir
// peuplé AppState.render pour que tous les autres modules puissent l'invoquer.

import { AppState, showToast } from '../state.js';
import { ICONS, escapeHtml } from '../config.js';
import { saveData } from '../db/data.js';
import { signOutSupabase, pullFromSupabase, updateSnapshotsFromCurrent, loadAccessContext } from '../db/sync.js';
import { renderAuthScreen } from '../auth.js';
import {
  renderConfirmModal, attachConfirmModal,
  renderRenameModal, attachRenameModal, renameSignataire,
  renderMemberDetailModal, attachMemberDetailModal,
  renderCompleteInfoModal, attachCompleteInfoModal,
} from '../components/modals.js';

import { renderDashboard, attachDashboardEvents } from './dashboard.js';
import { renderPointage, attachPointageEvents } from './pointage.js';
import { renderMembres, attachMembresEvents } from './membres.js';
import { renderRapports, attachRapportsEvents } from './rapports.js';
import { renderAmphitheatre, attachAmphitheatreEvents } from './amphitheatre.js';
import { renderAdministration, attachAdministrationEvents } from './administration.js';

export function render() {
  const app = document.getElementById('app');
  if (!AppState.data) { app.innerHTML = ''; return; }
  if (AppState.sb && AppState.sbUser && AppState.sbProfile && (!AppState.sbProfile.active || !AppState.activeSectionId)) { app.innerHTML = renderAccessPending(); attachAccessPending(); return; }
  if (AppState.sbProfile?.role === 'utilisateur') {
    if (AppState.tab !== 'amphitheatre') AppState.tab = 'amphitheatre';
  } else if (!AppState.data.profile.name) {
    app.innerHTML = renderOnboarding(); attachOnboarding(); return;
  }

  app.innerHTML = `
    <aside class="sidebar">
      <div class="brand">
        <div class="brand-mark">${ICONS.mark}</div>
        <div>
          <div class="brand-name">Carnet</div>
          <div class="brand-sub">Registre de présence</div>
        </div>
      </div>
      <nav class="tabs">
        ${AppState.sbProfile?.role !== 'utilisateur' ? tabBtn('dashboard', ICONS.dashboard, 'Tableau de bord') : ''}
        ${AppState.sbProfile?.role !== 'utilisateur' ? tabBtn('pointage', ICONS.pointage, 'Pointage') : ''}
        ${AppState.sbProfile?.role !== 'utilisateur' ? tabBtn('membres', ICONS.membres, 'Membres') : ''}
        ${AppState.sbProfile?.role !== 'utilisateur' ? tabBtn('rapports', ICONS.rapports, 'Rapports') : ''}
        ${tabBtn('amphitheatre', ICONS.amphi, 'Amphithéâtre')}
        ${AppState.sbProfile?.role === 'super_admin' ? tabBtn('administration', ICONS.settings, 'Administration') : ''}
      </nav>
      <div class="sidebar-footer">
        <div class="sidebar-org">${escapeHtml((AppState.sbSections.find(s => s.id === AppState.activeSectionId) || {}).nom || 'Commission Administrative')}</div>
        ${AppState.sbProfile?.role === 'super_admin' ? `<select id="sectionSwitcher" style="width:100%;margin:0 0 8px;">${AppState.sbSections.map(s => `<option value="${s.id}" ${s.id === AppState.activeSectionId ? 'selected' : ''}>${escapeHtml(s.nom)}</option>`).join('')}</select>` : ''}
        <div class="user-chip">
          <div class="avatar">${(AppState.data.profile.name || '?').trim()[0]?.toUpperCase() || '?'}</div>
          <div>
            <div class="user-name">${escapeHtml(AppState.data.profile.name)}</div>
            <div class="user-role">Signataire des rapports</div>
          </div>
          <button class="edit-name-btn" id="editNameBtn">modifier</button>
        </div>
        <button class="edit-name-btn signOutBtn" id="signOutBtn" style="margin-top:8px;">${AppState.sb && AppState.sbUser ? 'se déconnecter' : 'se connecter'}</button>
      </div>
    </aside>
    <main><div class="view" id="view">${renderTab()}</div></main>
  `;
  if (AppState.renameModalOpen) app.innerHTML += renderRenameModal();
  if (AppState.memberDetailId) app.innerHTML += renderMemberDetailModal();
  if (AppState.completeInfoQueue && AppState.completeInfoQueue.length) app.innerHTML += renderCompleteInfoModal();
  if (AppState.confirmModalOpen) app.innerHTML += renderConfirmModal();
  attachShellEvents();
  attachTabEvents();
  if (AppState.renameModalOpen) attachRenameModal();
  if (AppState.memberDetailId) attachMemberDetailModal();
  if (AppState.completeInfoQueue && AppState.completeInfoQueue.length) attachCompleteInfoModal();
  if (AppState.confirmModalOpen) attachConfirmModal();
}

function tabBtn(id, icon, label) {
  return `<button class="tab-btn ${AppState.tab === id ? 'active' : ''}" data-tab="${id}">${icon}<span>${label}</span></button>`;
}

function attachShellEvents() {
  document.querySelectorAll('.tab-btn').forEach(b => b.addEventListener('click', () => {
    AppState.tab = b.dataset.tab;
    if (AppState.tab === 'pointage' && !AppState.pointageProgId && AppState.data.programmes[0]) AppState.pointageProgId = AppState.data.programmes[0].id;
    render();
  }));
  const editBtn = document.getElementById('editNameBtn');
  if (editBtn) editBtn.addEventListener('click', renameSignataire);
  const signOutBtn = document.getElementById('signOutBtn');
  if (signOutBtn) signOutBtn.addEventListener('click', () => {
    if (AppState.sb && AppState.sbUser) signOutSupabase();
    else if (AppState.sb) renderAuthScreen();
  });
  const sectionSwitcher = document.getElementById('sectionSwitcher');
  if (sectionSwitcher) sectionSwitcher.addEventListener('change', async e => {
    AppState.activeSectionId = e.target.value;
    AppState.data = await pullFromSupabase();
    updateSnapshotsFromCurrent();
    render();
  });
}

/* ================= Accès en attente (comptes multi-utilisateurs) ================= */
function renderAccessPending() {
  const isAdmin = AppState.sbProfile?.role === 'super_admin';
  const isSelfServiceUser = AppState.sbProfile?.role === 'utilisateur' && !isAdmin;
  return `<div class="onboard-overlay"><div class="onboard-card"><div class="onboard-mark">${ICONS.mark}</div>
    <h2>${isAdmin ? 'Créer la première Section' : 'Accès en attente'}</h2>
    <p>${isAdmin ? 'Créez une Section pour commencer à organiser les données.' : (!AppState.sbProfile?.active ? 'Votre compte est désactivé. Contactez un super-administrateur.' : (isSelfServiceUser ? 'Indiquez votre Section : si votre email institutionnel figure dans sa base, vous accéderez automatiquement à l’Amphithéâtre.' : 'Votre compte attend son rattachement à une Section par un super-administrateur.'))}</p>
    ${isAdmin ? `<input id="firstSectionName" placeholder="Nom de la Section" autofocus /><button class="btn btn-primary" id="createFirstSectionBtn" style="width:100%;justify-content:center;margin-top:12px;">Créer la Section</button>` : ''}
    ${isSelfServiceUser && AppState.sbSections.length ? `
      <select id="claimSectionSelect" style="width:100%;margin-top:12px;">
        <option value="">Choisir votre Section…</option>
        ${AppState.sbSections.map(s => `<option value="${s.id}">${escapeHtml(s.nom)}</option>`).join('')}
      </select>
      <button class="btn btn-primary" id="claimSectionBtn" style="width:100%;justify-content:center;margin-top:10px;">Vérifier mon accès</button>
      <div id="claimSectionMsg" style="font-size:12px;color:var(--terracotta-dim);margin-top:8px;"></div>
    ` : ''}
    <button class="btn btn-ghost" id="pendingSignOutBtn" style="width:100%;justify-content:center;margin-top:10px;">Se déconnecter</button>
  </div></div>`;
}
function attachAccessPending() {
  const sb = AppState.sb;
  const create = document.getElementById('createFirstSectionBtn');
  if (create) create.addEventListener('click', async () => {
    const nom = document.getElementById('firstSectionName').value.trim();
    if (!nom) { showToast('Indiquez le nom de la Section'); return; }
    const { error } = await sb.from('sections').insert({ nom });
    if (error) { showToast(error.message); return; }
    await loadAccessContext();
    AppState.data = await pullFromSupabase();
    updateSnapshotsFromCurrent(); render();
  });
  const claimBtn = document.getElementById('claimSectionBtn');
  if (claimBtn) claimBtn.addEventListener('click', async () => {
    const sectionId = document.getElementById('claimSectionSelect').value;
    const msg = document.getElementById('claimSectionMsg');
    if (!sectionId) { msg.textContent = 'Choisissez une Section.'; return; }
    claimBtn.disabled = true; claimBtn.textContent = 'Vérification…';
    try {
      const { data, error } = await sb.rpc('try_auto_assign_utilisateur', { target_section_id: sectionId });
      if (error) throw error;
      if (data && data.matched) {
        showToast('Bienvenue ' + data.name + ' !');
        await loadAccessContext();
        AppState.data = await pullFromSupabase();
        updateSnapshotsFromCurrent();
        render();
      } else {
        msg.textContent = 'Votre email n’a pas été trouvé dans la base de cette Section. Contactez un responsable si vous pensez que c’est une erreur.';
        claimBtn.disabled = false; claimBtn.textContent = 'Vérifier mon accès';
      }
    } catch (e) {
      msg.textContent = 'Erreur : ' + (e && e.message ? e.message : 'réessayez plus tard');
      claimBtn.disabled = false; claimBtn.textContent = 'Vérifier mon accès';
    }
  });
  document.getElementById('pendingSignOutBtn').addEventListener('click', signOutSupabase);
}

/* ================= ONBOARDING ================= */
function renderOnboarding() {
  return `
  <div class="onboard-overlay">
    <div class="onboard-card">
      <div class="onboard-mark">${ICONS.mark}</div>
      <h2>Bienvenue dans Carnet</h2>
      <p>Comment devons-nous vous appeler ? Ce nom apparaîtra comme signataire sur vos rapports générés. Vous pourrez le modifier à tout moment.</p>
      <input type="text" id="onboardName" placeholder="Votre nom complet" autofocus />
      <button class="btn btn-primary" id="onboardBtn" style="width:100%;justify-content:center;">Commencer</button>
    </div>
  </div>`;
}
function attachOnboarding() {
  const go = async () => {
    const v = document.getElementById('onboardName').value.trim();
    if (!v) { showToast('Merci de renseigner un nom'); return; }
    AppState.data.profile.name = v;
    await saveData();
    render();
  };
  document.getElementById('onboardBtn').addEventListener('click', go);
  document.getElementById('onboardName').addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
}

/* ================= TAB ROUTER ================= */
function renderTab() {
  if (AppState.tab === 'dashboard') return renderDashboard();
  if (AppState.tab === 'pointage') return renderPointage();
  if (AppState.tab === 'membres') return renderMembres();
  if (AppState.tab === 'rapports') return renderRapports();
  if (AppState.tab === 'amphitheatre') return renderAmphitheatre();
  if (AppState.tab === 'administration' && AppState.sbProfile?.role === 'super_admin') return renderAdministration();
  return '';
}
function attachTabEvents() {
  if (AppState.tab === 'dashboard') attachDashboardEvents();
  if (AppState.tab === 'pointage') attachPointageEvents();
  if (AppState.tab === 'membres') attachMembresEvents();
  if (AppState.tab === 'rapports') attachRapportsEvents();
  if (AppState.tab === 'amphitheatre') attachAmphitheatreEvents();
  if (AppState.tab === 'administration') attachAdministrationEvents();
}
