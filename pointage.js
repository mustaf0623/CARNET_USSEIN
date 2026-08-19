// views/pointage.js — Onglet Pointage : sélection programme/séance et
// marquage présent/absent par membre. Les membres Sortants (figurants) sont
// affichés à part : jamais comptés parmi les inscrits, jamais marqués
// absents par défaut même en mode rapide — seul un clic explicite crée un
// pointage pour eux, s'ils se présentent exceptionnellement à une séance.
import { AppState, showToast, openConfirm } from '../state.js';
import { ICONS, escapeHtml, uid, fmtDate, initials } from '../config.js';
import { saveData } from '../db/data.js';
import { memberInProgramme, checkApPromotion, isSortant } from '../domain/membres.js';
import { emptyRow, sessionOptionsByYear } from '../components/ui.js';

export function renderPointage() {
  const d = AppState.data;
  const isReadOnly = AppState.sbProfile?.role === 'pf';
  if (!d.programmes.length) return `<div class="page-head"><div><div class="eyebrow">Registre</div><h1 class="page-title">Pointage</h1></div></div>
    <div class="card empty-state">${ICONS.pointage}<h3 style="color:var(--ink);margin:0 0 6px;">Aucun programme</h3><p>Créez d’abord un programme dans l’onglet Membres.</p></div>`;
  if (!AppState.pointageProgId) AppState.pointageProgId = d.programmes[0].id;
  const prog = d.programmes.find(p => p.id === AppState.pointageProgId);
  const pastSessions = d.sessions.filter(s => s.programmeId === AppState.pointageProgId).sort((a, b) => b.date.localeCompare(a.date));

  let currentPointages = {};
  if (AppState.pointageSessionId !== 'new') {
    d.pointages.filter(p => p.sessionId === AppState.pointageSessionId).forEach(p => currentPointages[p.membreId] = p.statut);
  }
  // Membres normalement inscrits à ce programme (hors Sortants, jamais
  // comptés parmi les effectifs actifs).
  let membres = d.membres.filter(m => memberInProgramme(m, AppState.pointageProgId) && !isSortant(m));
  // Sortants : pointables ponctuellement pour N'IMPORTE QUEL programme,
  // pas seulement ceux où ils étaient inscrits avant de le devenir.
  let sortants = d.membres.filter(isSortant);

  return `
    <div class="page-head">
      <div>
        <div class="eyebrow">Registre</div>
        <h1 class="page-title">Pointage</h1>
        <p class="page-sub">${isReadOnly ? 'Consultation du pointage (lecture seule).' : 'Marquez la présence ou l’absence pour une séance d’un programme.'}</p>
      </div>
    </div>
    <div class="pointage-controls">
      <div class="field">
        <label>Programme</label>
        <select id="progSelect">${d.programmes.map(p => `<option value="${p.id}" ${p.id === AppState.pointageProgId ? 'selected' : ''}>${escapeHtml(p.nom)}</option>`).join('')}</select>
      </div>
      <div class="field">
        <label>Séance</label>
        <select id="sessionSelect">
          ${isReadOnly ? '' : `<option value="new" ${AppState.pointageSessionId === 'new' ? 'selected' : ''}>+ Nouvelle séance</option>`}
          ${sessionOptionsByYear(pastSessions, AppState.pointageSessionId)}
        </select>
      </div>
      ${(!isReadOnly && AppState.pointageSessionId === 'new') ? `
      <div class="field"><label>Date</label><input type="date" id="sessionDate" value="${AppState.pointageDate}"></div>
      <div class="field"><label>Intitulé</label><input type="text" id="sessionLabel" placeholder="Ex. Séance du ${fmtDate(AppState.pointageDate)}" value="${escapeHtml(AppState.pointageLabel)}"></div>
      ` : ''}
    </div>
    <div class="card">
      <h3 class="card-title">${escapeHtml(prog.nom)}</h3>
      <div class="card-sub" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;">
        <span>${membres.length} membre${membres.length > 1 ? 's' : ''} inscrit${membres.length > 1 ? 's' : ''}</span>
        ${isReadOnly ? '' : `<label style="display:flex;align-items:center;gap:7px;font-size:12px;color:var(--ink-dim);font-weight:600;cursor:pointer;">
          <input type="checkbox" id="fastModeToggle" ${AppState.pointageFastMode ? 'checked' : ''} style="width:15px;height:15px;accent-color:var(--emerald);">
          Pointage rapide — tout le monde est présent par défaut, décochez les absents
        </label>`}
      </div>
      <div id="memberList">
        ${membres.length ? membres.map(m => memberRow(m, currentPointages[m.id], AppState.pointageFastMode, false, isReadOnly)).join('') : emptyRow('Aucun membre inscrit à ce programme.')}
        ${sortants.length ? `
          <div style="margin-top:22px;padding-top:14px;border-top:1px dashed var(--line-strong);">
            <div style="font-size:12px;font-weight:700;color:var(--ink-faint);text-transform:uppercase;letter-spacing:0.06em;margin-bottom:4px;">Sortants</div>
            <div style="font-size:11.5px;color:var(--ink-faint);margin-bottom:10px;">Figurants — non comptés dans les effectifs. Ne cochez que s’ils sont exceptionnellement présents à cette séance ; sinon, ne pas y toucher (aucun pointage n’est enregistré pour eux par défaut).</div>
          </div>
          ${sortants.map(m => memberRow(m, currentPointages[m.id], false, true, isReadOnly)).join('')}
        ` : ''}
      </div>
      ${(!isReadOnly && (membres.length || sortants.length)) ? `<div style="margin-top:20px;display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;">
        ${AppState.pointageSessionId !== 'new' ? `<button class="btn btn-ghost" id="deleteSessionBtn" style="color:var(--terracotta);border-color:var(--terracotta-tint);">Supprimer cette séance</button>` : '<span></span>'}
        <button class="btn btn-primary" id="saveSession">${ICONS.mark} Enregistrer le pointage</button>
      </div>` : ''}
    </div>
  `;
}

function memberRow(m, statut, fastMode, isSortantRow, isReadOnly) {
  let statusHtml;
  if (isReadOnly) {
    // Jamais de présélection "présent" trompeuse en lecture seule : on
    // affiche fidèlement ce qui est réellement enregistré, y compris
    // "Non pointé" si rien ne l'a jamais été pour cette séance.
    const label = statut === 'present' ? '✓ Présent' : statut === 'absent' ? 'Absent' : 'Non pointé';
    const cls = statut === 'present' ? 'present active' : statut === 'absent' ? 'absent active' : '';
    statusHtml = `<div class="status-toggle"><span class="status-btn ${cls}" style="cursor:default;">${label}</span></div>`;
  } else if (fastMode) {
    // En mode rapide, un membre pas encore pointé pour cette séance démarre
    // "présent" par défaut (au lieu de vide) : il suffit de décocher les
    // absents. Un statut déjà enregistré (present/absent) est toujours
    // respecté tel quel. Les Sortants ne bénéficient JAMAIS de ce défaut,
    // même si le mode rapide est actif globalement (fastMode est forcé à
    // false pour eux par l'appelant) : rien n'est présélectionné.
    const effectiveStatut = statut === undefined ? 'present' : statut;
    statusHtml = `<div class="status-toggle">
      <button class="status-btn present ${effectiveStatut === 'present' ? 'active' : ''}" data-statut="present" style="min-width:110px;">${effectiveStatut === 'present' ? '✓ Présent' : 'Absent'}</button>
    </div>`;
  } else {
    statusHtml = `<div class="status-toggle">
      <button class="status-btn present ${statut === 'present' ? 'active' : ''}" data-statut="present">Présent</button>
      <button class="status-btn absent ${statut === 'absent' ? 'active' : ''}" data-statut="absent">Absent</button>
    </div>`;
  }
  return `<div class="member-row" data-membre="${m.id}" ${isSortantRow ? 'data-sortant="1"' : ''}>
    <div class="member-avatar">${initials(m.nom, m.prenom)}</div>
    <div class="member-info">
      <button type="button" class="member-name-link" data-id="${m.id}" style="background:none;border:none;padding:0;font-size:13.5px;font-weight:700;color:var(--ink);cursor:pointer;text-decoration:underline;text-decoration-color:var(--line-strong);text-align:left;">${escapeHtml(m.prenom)} ${escapeHtml(m.nom)}</button>${m.ap ? ` <span class="pill" style="background:var(--gold-tint);border-color:var(--gold);color:var(--gold);font-size:10px;">AP</span>` : ''}${isSortantRow ? ` <span class="pill" style="background:var(--terracotta-tint);border-color:var(--terracotta);color:var(--terracotta-dim);font-size:10px;">Sortant</span>` : ''}
      <div class="member-meta">${m.sexe === 'H' ? 'Homme' : 'Femme'}</div>
    </div>
    ${statusHtml}
  </div>`;
}

export function attachPointageEvents() {
  const d = AppState.data;
  const progSel = document.getElementById('progSelect');
  if (progSel) progSel.addEventListener('change', e => { AppState.pointageProgId = e.target.value; AppState.pointageSessionId = 'new'; AppState.render(); });
  const sessSel = document.getElementById('sessionSelect');
  if (sessSel) sessSel.addEventListener('change', e => { AppState.pointageSessionId = e.target.value; AppState.render(); });
  const fastToggle = document.getElementById('fastModeToggle');
  if (fastToggle) fastToggle.addEventListener('change', e => { AppState.pointageFastMode = e.target.checked; AppState.render(); });
  const dateInput = document.getElementById('sessionDate');
  if (dateInput) dateInput.addEventListener('change', e => AppState.pointageDate = e.target.value);
  const labelInput = document.getElementById('sessionLabel');
  if (labelInput) labelInput.addEventListener('input', e => AppState.pointageLabel = e.target.value);
  const deleteSessBtn = document.getElementById('deleteSessionBtn');
  if (deleteSessBtn) deleteSessBtn.addEventListener('click', () => {
    const sess = d.sessions.find(s => s.id === AppState.pointageSessionId);
    openConfirm(
      'Supprimer cette séance ?',
      'Le pointage enregistré pour « ' + (sess ? sess.label : 'cette séance') + ' » sera définitivement supprimé.',
      async () => {
        d.pointages = d.pointages.filter(p => p.sessionId !== AppState.pointageSessionId);
        d.sessions = d.sessions.filter(s => s.id !== AppState.pointageSessionId);
        await saveData();
        AppState.pointageSessionId = 'new';
        showToast('Séance supprimée');
        AppState.render();
      }
    );
  });

  document.querySelectorAll('.member-name-link').forEach(btn => btn.addEventListener('click', () => {
    AppState.memberDetailId = btn.dataset.id;
    AppState.render();
  }));

  document.querySelectorAll('.status-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const row = btn.closest('.member-row');
      const wasActive = btn.classList.contains('active');
      const onlyOneBtn = row.querySelectorAll('.status-btn').length === 1;
      row.querySelectorAll('.status-btn').forEach(b => {
        b.classList.remove('active'); b.querySelector('.stamp')?.remove();
        if (onlyOneBtn) b.textContent = 'Absent';
      });
      if (onlyOneBtn && wasActive) return; // re-clic sur "Présent" déjà actif : on le désactive (redevient absent)
      btn.classList.add('active');
      if (btn.dataset.statut === 'present') {
        btn.textContent = '✓ Présent';
        const s = document.createElement('span'); s.className = 'stamp'; s.innerHTML = ICONS.stamp;
        btn.appendChild(s);
      }
    });
  });

  const saveBtn = document.getElementById('saveSession');
  if (saveBtn) saveBtn.addEventListener('click', async () => {
    let sessionId = AppState.pointageSessionId;
    if (sessionId === 'new') {
      const label = (document.getElementById('sessionLabel')?.value || '').trim() || ('Séance du ' + fmtDate(AppState.pointageDate));
      const sess = { id: uid(), programmeId: AppState.pointageProgId, date: AppState.pointageDate, label };
      d.sessions.push(sess);
      sessionId = sess.id;
    }
    const rows = document.querySelectorAll('#memberList .member-row');
    let marked = 0;
    let apTouched = [];
    rows.forEach(row => {
      const membreId = row.dataset.membre;
      const isSortantRow = row.dataset.sortant === '1';
      const active = row.querySelector('.status-btn.active');
      let statut;
      if (active) statut = active.dataset.statut;
      // Un Sortant non touché ne génère JAMAIS de pointage par défaut, même
      // en mode rapide — contrairement aux membres normalement inscrits.
      else if (!isSortantRow && AppState.pointageFastMode) statut = 'absent';
      else return;
      d.pointages = d.pointages.filter(p => !(p.sessionId === sessionId && p.membreId === membreId));
      d.pointages.push({ id: uid(), sessionId, membreId, statut });
      marked++;
      const membre = d.membres.find(m => m.id === membreId);
      if (membre && membre.ap) apTouched.push(membre);
    });
    const promoted = apTouched.filter(m => checkApPromotion(d, m.id));
    if (promoted.length) AppState.completeInfoQueue = (AppState.completeInfoQueue || []).concat(promoted.map(m => m.id));
    await saveData();
    AppState.pointageSessionId = sessionId;
    AppState.pointageLabel = '';
    showToast(marked
      ? 'Pointage enregistré (' + marked + ' membres)' + (promoted.length ? ' — ' + promoted.map(m => m.prenom + ' ' + m.nom).join(', ') + ' intégré(s) définitivement à la base' : '')
      : 'Aucun statut sélectionné');
    AppState.render();
  });
}
