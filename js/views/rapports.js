// views/rapports.js — Onglet Rapports : configuration et génération de PDF
// signés, répertoire des absences consécutives.
import { AppState } from '../state.js';
import { ICONS, escapeHtml, fmtDate, nowTime, todayISO } from '../config.js';
import { absenceWatchlist, getAvailableYears, getAvailableMonths, monthLabel } from '../domain/stats.js';
import { emptyRow, sessionOptionsByYear } from '../components/ui.js';
import { downloadPdf } from '../export/pdf-export.js';
import { renameSignataire } from '../components/modals.js';
import { showToast } from '../state.js';

export function renderRapports() {
  const d = AppState.data;
  const threshold = AppState.absenceThreshold || 3;
  const watchlistProgId = AppState.watchlistProgramme || 'tous';
  let watchlist = absenceWatchlist(d, threshold);
  if (watchlistProgId !== 'tous') watchlist = watchlist.filter(r => r.programme.id === watchlistProgId);
  const scope = AppState.reportScope || 'global';
  const sessionId = AppState.reportSessionId || 'toutes';
  const scopeOptions = [`<option value="global" ${scope === 'global' ? 'selected' : ''}>Tous les programmes</option>`].concat(
    d.programmes.map(p => `<option value="${p.id}" ${scope === p.id ? 'selected' : ''}>${escapeHtml(p.nom)}</option>`)
  ).join('');
  const years = getAvailableYears(d);
  const months = getAvailableMonths(d, scope);
  const periodOptions = `<option value="toutes">Toutes périodes</option>`
    + (years.length ? `<optgroup label="Par année">${years.map(y => `<option value="${y}">${y}</option>`).join('')}</optgroup>` : '')
    + (months.length ? `<optgroup label="Par mois">${months.map(mo => `<option value="${mo}">${monthLabel(mo)}</option>`).join('')}</optgroup>` : '');
  const progSessions = scope !== 'global' ? d.sessions.filter(s => s.programmeId === scope) : [];
  const sessionOptions = `<option value="toutes" ${sessionId === 'toutes' ? 'selected' : ''}>Toutes les séances</option>` + sessionOptionsByYear(progSessions, sessionId);
  return `
    <div class="page-head">
      <div>
        <div class="eyebrow">Export</div>
        <h1 class="page-title">Rapports</h1>
        <p class="page-sub">Générez un rapport statistique détaillé, global, par programme, par mois ou pour une séance précise, signé et prêt à partager.</p>
      </div>
    </div>
    <div class="grid grid-2">
      <div class="card">
        <h3 class="card-title">Configuration du rapport</h3>
        <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px;">
          <div class="field" style="flex:1;">
            <label>Portée</label>
            <select id="reportScope" style="width:100%;">${scopeOptions}</select>
          </div>
          ${scope !== 'global' ? `<div class="field" style="flex:1;">
            <label>Séance</label>
            <select id="reportSession" style="width:100%;">${sessionOptions}</select>
          </div>` : ''}
          ${sessionId === 'toutes' ? `<div class="field" style="flex:1;">
            <label>Période</label>
            <select id="reportYear" style="width:100%;">${periodOptions}</select>
          </div>` : ''}
        </div>
        <p style="font-size:12.5px;color:var(--ink-faint);line-height:1.6;">
          ${sessionId !== 'toutes' && scope !== 'global'
            ? 'Le rapport listera la présence de chaque membre pour cette séance précise, avec le taux de présence associé.'
            : 'Le rapport inclura : effectifs, répartition Hommes/Femmes, taux de présence, taux d’absence et taux de participation — globaux ou filtrés selon la portée et la période choisies (année entière ou un mois précis).'}
        </p>
        <div style="margin-top:18px;">
          <button class="btn btn-primary" id="genPdfBtn">${ICONS.download} Générer le PDF</button>
        </div>
      </div>
      <div class="card">
        <h3 class="card-title">Signature</h3>
        <div class="card-sub">Ajoutée automatiquement en pied de rapport</div>
        <div class="ledger-row" style="border-bottom:none;">
          <div class="avatar" style="margin-right:4px;">${(d.profile.name || '?').trim()[0]?.toUpperCase() || '?'}</div>
          <div>
            <div style="font-weight:700;font-family:'Fraunces',serif;font-size:15px;">${escapeHtml(d.profile.name)}</div>
            <div style="font-size:12px;color:var(--ink-faint);" class="mono">Généré le ${fmtDate(todayISO())} à ${nowTime()}</div>
          </div>
        </div>
        <button class="btn btn-ghost btn-sm" id="changeSignataireBtn" style="margin-top:14px;">Changer le signataire</button>
      </div>
    </div>
    <div class="card" style="margin-top:20px;">
      <h3 class="card-title" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;">
        <span>Répertoire — absences consécutives</span>
        <span style="display:flex;align-items:center;gap:8px;font-size:12px;font-weight:600;color:var(--ink-dim);flex-wrap:wrap;">
          Programme
          <select id="watchlistProgramme" style="padding:5px 8px;">
            <option value="tous" ${watchlistProgId === 'tous' ? 'selected' : ''}>Tous les programmes</option>
            ${d.programmes.map(p => `<option value="${p.id}" ${watchlistProgId === p.id ? 'selected' : ''}>${escapeHtml(p.nom)}</option>`).join('')}
          </select>
          Seuil <input type="number" id="absenceThreshold" min="1" max="20" value="${threshold}" style="width:56px;text-align:center;padding:5px 6px;">
        </span>
      </h3>
      <div class="card-sub">Membres permanents (hors "Ponctuel/AP") ayant ${threshold} absence${threshold > 1 ? 's' : ''} ou plus d’affilée${watchlistProgId === 'tous' ? ' sur un programme' : ' sur ' + escapeHtml((d.programmes.find(p => p.id === watchlistProgId) || {}).nom || 'ce programme')}.</div>
      <div class="ledger" style="margin-top:6px;">
        ${watchlist.length ? watchlist.map(r => `<div class="ledger-row">
          <div style="flex:1;min-width:0;">
            <div class="prog-name">${escapeHtml(r.membre.prenom)} ${escapeHtml(r.membre.nom)}</div>
            ${watchlistProgId === 'tous' ? `<div style="font-size:11.5px;color:var(--ink-faint);">${escapeHtml(r.programme.nom)}${r.lastDate ? ' — dernière séance pointée : ' + fmtDate(r.lastDate) : ''}</div>` : (r.lastDate ? `<div style="font-size:11.5px;color:var(--ink-faint);">Dernière séance pointée : ${fmtDate(r.lastDate)}</div>` : '')}
          </div>
          <span class="pill" style="background:var(--terracotta-tint);border-color:var(--terracotta);color:var(--terracotta-dim);font-weight:700;white-space:nowrap;">${r.streak} absences</span>
        </div>`).join('') : emptyRow(`Aucun membre permanent avec ${threshold} absence${threshold > 1 ? 's' : ''} consécutive${threshold > 1 ? 's' : ''} ou plus.`)}
      </div>
    </div>
  `;
}

export function attachRapportsEvents() {
  const watchlistProgSel = document.getElementById('watchlistProgramme');
  if (watchlistProgSel) watchlistProgSel.addEventListener('change', e => {
    AppState.watchlistProgramme = e.target.value;
    AppState.render();
  });
  const thresholdInput = document.getElementById('absenceThreshold');
  if (thresholdInput) thresholdInput.addEventListener('change', e => {
    const v = parseInt(e.target.value, 10);
    AppState.absenceThreshold = (v && v > 0) ? v : 3;
    AppState.render();
  });
  const scopeSel = document.getElementById('reportScope');
  if (scopeSel) scopeSel.addEventListener('change', e => {
    AppState.reportScope = e.target.value;
    AppState.reportSessionId = 'toutes';
    AppState.render();
  });
  const sessionSel = document.getElementById('reportSession');
  if (sessionSel) sessionSel.addEventListener('change', e => {
    AppState.reportSessionId = e.target.value;
    AppState.render();
  });
  const yearSel = document.getElementById('reportYear');
  if (yearSel) {
    // La période est conservée lorsqu'un changement de portée ou de séance réaffiche le formulaire.
    if (Array.from(yearSel.options).some(option => option.value === AppState.reportYear)) yearSel.value = AppState.reportYear;
    else AppState.reportYear = 'toutes';
    yearSel.addEventListener('change', e => { AppState.reportYear = e.target.value; });
  }
  const genBtn = document.getElementById('genPdfBtn');
  if (genBtn) genBtn.addEventListener('click', () => {
    const scope = AppState.reportScope || 'global';
    const sessionId = AppState.reportSessionId || 'toutes';
    const yearVal = AppState.reportYear || 'toutes';
    if (sessionId !== 'toutes' && scope !== 'global') downloadPdf(scope, 'toutes', sessionId);
    else downloadPdf(scope, yearVal);
    showToast('Rapport PDF téléchargé');
  });
  const changeSigBtn = document.getElementById('changeSignataireBtn');
  if (changeSigBtn) changeSigBtn.addEventListener('click', renameSignataire);
}
