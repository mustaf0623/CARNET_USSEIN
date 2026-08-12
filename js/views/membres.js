// views/membres.js — Onglet Membres & programmes : gestion des programmes,
// ajout manuel de membres, import Excel, export Excel/PDF, zone sensible.
import { AppState, showToast, openConfirm } from '../state.js';
import { ICONS, escapeHtml, uid, todayISO } from '../config.js';
import { saveData, resetAppData } from '../db/data.js';
import { memberInProgramme, extraFieldKeys, isSortant, daysSinceSortant, hasSortantAccessExpired, SORTANT_GRACE_DAYS } from '../domain/membres.js';
import { emptyRow } from '../components/ui.js';
import { buildStyledSheet } from '../export/xlsx-export.js';
import { buildExportPdf } from '../export/pdf-export.js';

export function renderMembres() {
  const d = AppState.data;
  return `
    <div class="page-head">
      <div>
        <div class="eyebrow">Base de données</div>
        <h1 class="page-title">Membres &amp; programmes</h1>
        <p class="page-sub">Gérez vos programmes, ajoutez des membres un par un ou importez un fichier Excel existant.</p>
      </div>
    </div>
    <div class="grid grid-2" style="align-items:start;">
      <div class="card">
        <h3 class="card-title">Programmes</h3>
        <div class="card-sub">${d.programmes.length} programme${d.programmes.length > 1 ? 's' : ''}</div>
        <div class="ledger">${d.programmes.map(p => `<div class="ledger-row"><div class="prog-name">${escapeHtml(p.nom)}</div><div style="color:var(--ink-faint);font-size:12px;" class="mono">${d.membres.filter(m => memberInProgramme(m, p.id)).length} membres</div><button class="edit-name-btn delete-prog-btn" data-id="${p.id}" style="color:var(--terracotta);">supprimer</button></div>`).join('') || emptyRow('Aucun programme pour l’instant.')}</div>
        <div style="display:flex;gap:8px;margin-top:16px;">
          <input type="text" id="newProgName" placeholder="Nom du nouveau programme" style="flex:1;">
          <button class="btn btn-primary btn-sm" id="addProgBtn">${ICONS.plus} Ajouter</button>
        </div>
      </div>
      <div class="card">
        <h3 class="card-title">Ajouter un membre</h3>
        <div class="card-sub">Saisie manuelle</div>
        <div class="field" style="margin-bottom:10px;"><label>Prénom</label><input type="text" id="newPrenom" style="width:100%;"></div>
        <div class="field" style="margin-bottom:10px;"><label>Nom</label><input type="text" id="newNom" style="width:100%;"></div>
        <div class="field" style="margin-bottom:10px;">
          <label>Sexe</label>
          <select id="newSexe" style="width:100%;"><option value="H">Homme</option><option value="F">Femme</option></select>
        </div>
        <div class="field" style="margin-bottom:14px;">
          <label>Type de membre</label>
          <div class="status-toggle" id="newMembreType">
            <button type="button" class="status-btn present active" data-ap="0" style="flex:1;">Permanent</button>
            <button type="button" class="status-btn absent" data-ap="1" style="flex:1;">Ponctuel (AP)</button>
          </div>
          <div style="font-size:11.5px;color:var(--ink-faint);margin-top:6px;line-height:1.5;" id="newMembreTypeHint">Automatiquement pointable dans tous les programmes déjà créés et ceux à venir.</div>
        </div>
        <div class="field" style="margin-bottom:14px;" id="newMembreExtraPermanent">
          <label>Informations complémentaires (base importée)</label>
          ${(() => {
            const keys = extraFieldKeys(d);
            if (!keys.length) return `<div style="font-size:11.5px;color:var(--ink-faint);">Aucun champ détecté pour l’instant — importez d’abord un fichier pour que ces champs apparaissent ici.</div>`;
            return `<div class="extra-info-grid" style="max-height:min(260px, 40vh);">${keys.map(k => `<div class="extra-info-item"><label>${escapeHtml(k)}</label><div class="extra-info-row"><input type="text" class="newMembreExtraInput" data-key="${escapeHtml(k)}"></div></div>`).join('')}</div>`;
          })()}
        </div>
        <div class="field" style="margin-bottom:14px;display:none;" id="newMembreContactAP">
          <label>Contact</label>
          <input type="text" id="newMembreContact" placeholder="Téléphone ou email" style="width:100%;">
        </div>
        <div class="field" style="margin-bottom:14px;" id="newMembreProgsField">
          <label>Programmes</label>
          <div class="chip-select" id="newMembreProgs">
            ${d.programmes.map(p => `<button type="button" class="chip" data-id="${p.id}">${escapeHtml(p.nom)}</button>`).join('') || '<span style="color:var(--ink-faint);font-size:12.5px;">Créez d’abord un programme.</span>'}
          </div>
        </div>
        <button class="btn btn-primary" id="addMembreBtn" style="width:100%;justify-content:center;">${ICONS.plus} Ajouter le membre</button>
      </div>
    </div>

    <div class="card" style="margin-top:16px;">
      <h3 class="card-title">Importer un fichier Excel</h3>
      <div class="card-sub">Les en-têtes déjà présentes dans votre fichier seront reconnues et associées automatiquement</div>
      ${renderImportZone()}
    </div>

    <div class="card" style="margin-top:16px;">
      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;margin-bottom:4px;">
        <h3 class="card-title" style="margin:0;">Membres</h3>
        <div style="display:flex;gap:6px;">
          <button type="button" class="btn btn-sm ${AppState.membresSubTab !== 'sortants' ? 'btn-primary' : 'btn-ghost'}" id="membresTabActifs">Actifs</button>
          <button type="button" class="btn btn-sm ${AppState.membresSubTab === 'sortants' ? 'btn-primary' : 'btn-ghost'}" id="membresTabSortants">Sortants${d.membres.some(isSortant) ? ' (' + d.membres.filter(isSortant).length + ')' : ''}</button>
        </div>
      </div>
      ${(() => {
        const actifs = d.membres.filter(m => !isSortant(m));
        const sortants = d.membres.filter(isSortant);
        const isSortantsTab = AppState.membresSubTab === 'sortants';
        const scoped = isSortantsTab ? sortants : actifs;
        return `<div class="card-sub">${isSortantsTab
          ? `${sortants.length} membre${sortants.length > 1 ? 's' : ''} sortant${sortants.length > 1 ? 's' : ''} — figurants, exclus des statistiques, du tableau de bord, des rapports et des exports`
          : `${actifs.length} au total${actifs.some(m => m.ap) ? ' · ' + actifs.filter(m => m.ap).length + ' membre(s) ponctuel(s) (AP)' : ''}`}</div>
      <div style="margin:12px 0 14px;">
        <input type="text" id="membreSearch" placeholder="Rechercher un membre (nom, prénom...)" value="${escapeHtml(AppState.membreSearch || '')}" style="width:100%;">
      </div>
      ${(() => {
        const q = (AppState.membreSearch || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        const filtered = q ? scoped.filter(m => {
          if (norm(`${m.prenom} ${m.nom}`).includes(q)) return true;
          return Object.values(m.extra || {}).some(v => norm(v).includes(q));
        }) : scoped;
        if (!scoped.length) return emptyRow(isSortantsTab ? 'Aucun membre Sortant pour l’instant.' : 'Aucun membre pour l’instant.');
        if (!filtered.length) return emptyRow('Aucun membre ne correspond à cette recherche.');
        if (isSortantsTab) {
          return `<table class="data-table"><thead><tr><th>Nom</th><th>Sexe</th><th>Sortant depuis</th><th>Compte lié</th><th></th></tr></thead><tbody>
          ${filtered.map(m => {
            const days = daysSinceSortant(m);
            const linkedUser = (AppState.sbUsers || []).find(u => u.matched_membre_id === m.id);
            let compteHtml = '—';
            if (linkedUser) {
              const expired = hasSortantAccessExpired(m);
              compteHtml = expired
                ? `<span class="pill" style="background:var(--terracotta-tint);border-color:var(--terracotta);color:var(--terracotta-dim);">Accès coupé</span>`
                : `<span class="pill" style="background:var(--gold-tint);border-color:var(--gold);color:var(--gold);">Accès actif · ${SORTANT_GRACE_DAYS - days}j restants</span>`;
            }
            return `<tr><td><button class="member-name-link" data-id="${m.id}" style="background:none;border:none;padding:0;color:var(--ink);font-weight:700;cursor:pointer;text-decoration:underline;text-decoration-color:var(--line-strong);">${escapeHtml(m.prenom)} ${escapeHtml(m.nom)}</button></td><td>${m.sexe === 'H' ? 'Homme' : 'Femme'}</td><td>${days !== null ? days + ' jour' + (days > 1 ? 's' : '') : '—'}</td><td>${compteHtml}</td><td><button class="edit-name-btn delete-membre-btn" data-id="${m.id}" style="color:var(--terracotta);">supprimer</button></td></tr>`;
          }).join('')}
        </tbody></table>`;
        }
        return `<table class="data-table"><thead><tr><th>Nom</th><th>Sexe</th><th>Programmes</th><th></th></tr></thead><tbody>
        ${filtered.map(m => `<tr><td><button class="member-name-link" data-id="${m.id}" style="background:none;border:none;padding:0;color:var(--ink);font-weight:700;cursor:pointer;text-decoration:underline;text-decoration-color:var(--line-strong);">${escapeHtml(m.prenom)} ${escapeHtml(m.nom)}</button>${m.ap ? ` <span class="pill" style="background:var(--gold-tint);border-color:var(--gold);color:var(--gold);">AP</span>` : ''}${m.extra && Object.keys(m.extra).length ? ` <span class="pill" style="background:var(--gold-tint);border-color:var(--gold);color:var(--gold);font-size:10px;" title="Informations importées disponibles">i</span>` : ''}</td><td>${m.sexe === 'H' ? 'Homme' : 'Femme'}</td><td>${m.allProgrammes ? `<span class="pill" style="background:var(--emerald-tint);border-color:var(--emerald);color:var(--emerald-dim);">Tous les programmes</span>` : m.programmeIds.map(pid => `<span class="pill">${escapeHtml((d.programmes.find(p => p.id === pid) || {}).nom || '—')}</span>`).join('')}</td><td><button class="edit-name-btn delete-membre-btn" data-id="${m.id}" style="color:var(--terracotta);">supprimer</button></td></tr>`).join('')}
      </tbody></table>`;
      })()}`;
      })()}
    </div>

    <div class="card" style="margin-top:16px;">
      <h3 class="card-title">Exporter la base</h3>
      <div class="card-sub">Choisissez les colonnes à inclure, affinez les filtres si besoin, puis exportez.</div>
      <div class="card-sub" style="margin-top:-8px;">Les membres Sortants ne sont jamais inclus dans les exports.</div>

      <div class="card-sub" style="margin-top:14px;font-weight:700;color:var(--ink-dim);">Colonnes</div>
      <div class="extra-info-grid" style="margin-top:8px;max-height:none;">
        ${[{ key: '__prenom', label: 'Prénom' }, { key: '__nom', label: 'Nom' }, { key: '__sexe', label: 'Sexe' }, { key: '__type', label: 'Type (Permanent/AP)' }, { key: '__programmes', label: 'Programmes' }]
          .map(f => `<label style="display:flex;align-items:center;gap:6px;background:var(--card-2);border:1px solid var(--line);border-radius:10px;padding:8px 9px;font-size:12px;cursor:pointer;"><input type="checkbox" class="exportColCheckbox" value="${escapeHtml(f.key)}" checked>${escapeHtml(f.label)}</label>`).join('')}
      </div>

      <div class="card-sub" style="margin-top:16px;font-weight:700;color:var(--ink-dim);">Filtrer qui exporter</div>
      <div style="display:flex;flex-direction:column;gap:8px;margin-top:8px;">
        <div style="border:1px solid var(--line);border-radius:10px;padding:9px 12px;">
          <div style="font-size:12.5px;font-weight:700;margin-bottom:7px;">Type</div>
          <div style="display:flex;flex-wrap:wrap;gap:12px;font-size:12px;">
            <label style="display:flex;align-items:center;gap:5px;cursor:pointer;"><input type="checkbox" class="exportTypeFilter" value="permanent" checked>Permanent</label>
            <label style="display:flex;align-items:center;gap:5px;cursor:pointer;"><input type="checkbox" class="exportTypeFilter" value="ap" checked>Ponctuel (AP)</label>
          </div>
          <div style="font-size:11px;color:var(--ink-faint);margin-top:6px;">Si des membres AP sont inclus, leur contact est automatiquement récupéré dans l’export.</div>
        </div>
        <div style="border:1px solid var(--line);border-radius:10px;padding:9px 12px;">
          <div style="font-size:12.5px;font-weight:700;margin-bottom:7px;">Programmes</div>
          <div style="display:flex;flex-wrap:wrap;gap:12px;font-size:12px;">
            <label style="display:flex;align-items:center;gap:5px;cursor:pointer;"><input type="checkbox" class="exportProgFilter" value="tous" id="exportProgAll" checked>Tous les programmes</label>
            ${d.programmes.map(p => `<label style="display:flex;align-items:center;gap:5px;cursor:pointer;opacity:0.5;" class="exportProgOne"><input type="checkbox" class="exportProgFilter" value="${p.id}" disabled>${escapeHtml(p.nom)}</label>`).join('')}
          </div>
        </div>
      </div>

      ${extraFieldKeys(d).length ? `
        <div class="card-sub" style="margin-top:16px;font-weight:700;color:var(--ink-dim);">Informations importées</div>
        <div class="extra-info-grid" style="margin-top:8px;max-height:min(240px, 40vh);">
          ${extraFieldKeys(d).map(k => `<label style="display:flex;align-items:center;gap:6px;background:var(--card-2);border:1px solid var(--line);border-radius:10px;padding:8px 9px;font-size:12px;cursor:pointer;"><input type="checkbox" class="exportColCheckbox" value="${escapeHtml(k)}" checked>${escapeHtml(k)}</label>`).join('')}
        </div>
      ` : ''}

      <div style="display:flex;gap:10px;margin-top:16px;flex-wrap:wrap;">
        <button class="btn btn-primary btn-sm" id="exportXlsxBtn">Exporter en Excel (.xlsx)</button>
        <button class="btn btn-ghost btn-sm" id="exportPdfBtn">Exporter en PDF</button>
      </div>
    </div>

    <div class="card" style="margin-top:16px;border-color:var(--terracotta-tint);">
      <h3 class="card-title" style="color:var(--terracotta-dim);">Zone sensible</h3>
      <div class="card-sub">Réinitialise entièrement l’application : programmes, membres, séances et pointages. Votre nom de signataire est conservé.</div>
      <button class="btn" id="resetAllBtn" style="background:var(--terracotta);border-color:transparent;color:#fff;">Réinitialiser toutes les données</button>
      <div class="card-sub" style="margin-top:16px;">Supprime tous les membres (permanents et ponctuels) et leurs pointages associés — retour à zéro membre, comme s’il n’y avait jamais eu d’import. Les programmes et les séances restent intacts.</div>
      <button class="btn btn-ghost" id="clearImportedDataBtn" style="border-color:var(--terracotta);color:var(--terracotta-dim);">Supprimer tous les membres</button>
    </div>
  `;
}

function renderImportZone() {
  if (AppState.importStep === 0) {
    return `<div class="drop-zone" id="dropZone">
      ${ICONS.upload}
      <p style="margin:12px 0 4px;font-weight:700;">Cliquez pour choisir un fichier .xlsx ou .csv</p>
      <p style="margin:0;color:var(--ink-faint);font-size:12.5px;">Vos données restent sur cet appareil</p>
      <input type="file" id="fileInput" accept=".xlsx,.xls,.csv" style="display:none;">
    </div>`;
  }
  if (AppState.importStep === 1) {
    const expected = [
      { key: 'prenom', label: 'Prénom' }, { key: 'nom', label: 'Nom' },
      { key: 'sexe', label: 'Sexe' },
    ];
    return `<div>
      <p style="font-size:13px;color:var(--ink-dim);margin-bottom:14px;">${AppState.importRows.length} lignes détectées. Vérifiez la correspondance des colonnes avant l’import.</p>
      <div class="mapping-row"><strong style="font-size:11.5px;text-transform:uppercase;color:var(--ink-faint);">Champ attendu</strong><strong style="font-size:11.5px;text-transform:uppercase;color:var(--ink-faint);">Colonne du fichier</strong></div>
      ${expected.map(f => `<div class="mapping-row">
        <div>${f.label}</div>
        <select data-field="${f.key}" class="mapSelect">
          <option value="">— Ignorer —</option>
          ${AppState.importHeaders.map(h => `<option value="${escapeHtml(h)}" ${AppState.importMapping[f.key] === h ? 'selected' : ''}>${escapeHtml(h)}</option>`).join('')}
        </select>
      </div>`).join('')}

      <div style="margin-top:18px;margin-bottom:14px;">
        <div style="font-size:12px;font-weight:700;color:var(--ink-dim);margin-bottom:8px;">Aperçu du tableau</div>
        <div style="overflow-x:auto;border:1px solid var(--line);border-radius:8px;">
          <table style="width:100%;border-collapse:collapse;font-size:12px;">
            <thead>
              <tr style="background:var(--card-2);border-bottom:1px solid var(--line);">
                ${expected.filter(f => AppState.importMapping[f.key]).map(f => `<th style="padding:8px 10px;text-align:left;font-weight:700;white-space:nowrap;">${escapeHtml(f.label)}</th>`).join('')}
              </tr>
            </thead>
            <tbody>
              ${(AppState.importRows || []).slice(0, 3).map((row, idx) => `<tr style="border-bottom:1px solid var(--line);${idx % 2 ? 'background:var(--card-2);' : ''}">
                ${expected.filter(f => AppState.importMapping[f.key]).map(f => `<td style="padding:8px 10px;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(String(row[AppState.importMapping[f.key]] || ''))}</td>`).join('')}
              </tr>`).join('')}
            </tbody>
          </table>
        </div>
        <div style="font-size:11px;color:var(--ink-faint);margin-top:6px;">Affichage des ${Math.min(3, AppState.importRows.length)} première(s) ligne(s)</div>
      </div>

      <p style="font-size:12px;color:var(--ink-faint);line-height:1.6;margin-top:14px;">Une fois importés, ces membres seront pointables dans tous les programmes déjà créés — et automatiquement dans ceux que vous créerez plus tard.</p>
      <div style="display:flex;gap:10px;margin-top:14px;">
        <button class="btn btn-primary" id="confirmImportBtn">Importer</button>
        <button class="btn btn-ghost" id="cancelImportBtn">Annuler</button>
      </div>
    </div>`;
  }
  return '';
}

function guessMapping(headers) {
  const norm = h => h.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const map = {};
  const dict = {
    prenom: ['prenom', 'firstname', 'first name'],
    nom: ['nom', 'lastname', 'last name', 'nom de famille'],
    sexe: ['sexe', 'genre', 'gender'],
  };
  Object.entries(dict).forEach(([key, aliases]) => {
    const found = headers.find(h => aliases.includes(norm(h)));
    if (found) map[key] = found;
  });
  return map;
}

export function attachMembresEvents() {
  const d = AppState.data;
  const tabActifs = document.getElementById('membresTabActifs');
  if (tabActifs) tabActifs.addEventListener('click', () => { AppState.membresSubTab = 'actifs'; AppState.render(); });
  const tabSortants = document.getElementById('membresTabSortants');
  if (tabSortants) tabSortants.addEventListener('click', () => { AppState.membresSubTab = 'sortants'; AppState.render(); });

  const membreSearch = document.getElementById('membreSearch');
  if (membreSearch) membreSearch.addEventListener('input', e => {
    AppState.membreSearch = e.target.value;
    const pos = e.target.selectionStart;
    AppState.render();
    const again = document.getElementById('membreSearch');
    if (again) { again.focus(); again.setSelectionRange(pos, pos); }
  });

  const progAllCb = document.getElementById('exportProgAll');
  const progOneCbs = () => Array.from(document.querySelectorAll('.exportProgOne input.exportProgFilter'));
  if (progAllCb) progAllCb.addEventListener('change', () => {
    progOneCbs().forEach(cb => {
      cb.disabled = progAllCb.checked;
      cb.closest('.exportProgOne').style.opacity = progAllCb.checked ? '0.5' : '1';
      if (progAllCb.checked) cb.checked = false;
    });
  });
  progOneCbs().forEach(cb => cb.addEventListener('change', () => {
    if (cb.checked && progAllCb) { progAllCb.checked = false; progOneCbs().forEach(c => { c.disabled = false; c.closest('.exportProgOne').style.opacity = '1'; }); }
  }));

  function buildExportRows() {
    const checked = Array.from(document.querySelectorAll('.exportColCheckbox:checked')).map(cb => cb.value);
    if (!checked.length) { showToast('Sélectionnez au moins une colonne'); return null; }
    const typeChecked = Array.from(document.querySelectorAll('.exportTypeFilter:checked')).map(cb => cb.value);
    const progAll = document.getElementById('exportProgAll')?.checked;
    const progChecked = Array.from(document.querySelectorAll('.exportProgFilter:checked')).map(cb => cb.value).filter(v => v !== 'tous');
    if (!typeChecked.length) { showToast('Sélectionnez au moins un type (Permanent ou AP)'); return null; }
    if (!progAll && !progChecked.length) { showToast('Sélectionnez au moins un programme, ou « Tous les programmes »'); return null; }
    const filtered = d.membres.filter(m => {
      if (isSortant(m)) return false;
      if (!typeChecked.includes(m.ap ? 'ap' : 'permanent')) return false;
      if (!progAll && !progChecked.some(pid => memberInProgramme(m, pid))) return false;
      return true;
    });
    if (!filtered.length) { showToast('Aucun membre ne correspond à ces filtres'); return null; }
    const hasAp = filtered.some(m => m.ap);
    const cols = checked.slice();
    if (hasAp && extraFieldKeys(d).includes('Contact') && !cols.includes('Contact')) cols.push('Contact');
    return filtered.map(m => {
      const row = {};
      cols.forEach(key => {
        if (key === '__prenom') row['Prénom'] = m.prenom;
        else if (key === '__nom') row['Nom'] = m.nom;
        else if (key === '__sexe') row['Sexe'] = m.sexe === 'H' ? 'Homme' : 'Femme';
        else if (key === '__type') row['Type'] = m.ap ? 'Ponctuel (AP)' : 'Permanent';
        else if (key === '__programmes') row['Programmes'] = m.allProgrammes ? 'Tous les programmes' : m.programmeIds.map(pid => (d.programmes.find(p => p.id === pid) || {}).nom).filter(Boolean).join(', ');
        else row[key] = (m.extra && m.extra[key]) || '';
      });
      return row;
    });
  }

  const exportXlsxBtn = document.getElementById('exportXlsxBtn');
  if (exportXlsxBtn) exportXlsxBtn.addEventListener('click', () => {
    const rows = buildExportRows();
    if (!rows) return;
    const ws = buildStyledSheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Membres');
    XLSX.writeFile(wb, `carnet-export-membres-${new Date().toISOString().slice(0, 10)}.xlsx`);
    showToast('Export Excel généré');
  });

  const exportPdfBtn = document.getElementById('exportPdfBtn');
  if (exportPdfBtn) exportPdfBtn.addEventListener('click', () => {
    const rows = buildExportRows();
    if (!rows) return;
    buildExportPdf(rows);
    showToast('Export PDF généré');
  });

  const addProg = document.getElementById('addProgBtn');
  if (addProg) addProg.addEventListener('click', async () => {
    const input = document.getElementById('newProgName');
    const name = input.value.trim();
    if (!name) { showToast('Merci de saisir un nom de programme'); return; }
    d.programmes.push({ id: uid(), nom: name });
    await saveData(); showToast('Programme ajouté'); AppState.render();
  });

  let selectedProgs = new Set();
  document.querySelectorAll('#newMembreProgs .chip').forEach(chip => {
    chip.addEventListener('click', () => { chip.classList.toggle('on'); if (chip.classList.contains('on')) selectedProgs.add(chip.dataset.id); else selectedProgs.delete(chip.dataset.id); });
  });
  const progsField = document.getElementById('newMembreProgsField');
  if (progsField) progsField.style.display = 'none';
  document.querySelectorAll('#newMembreType .status-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#newMembreType .status-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const isAp = btn.dataset.ap === '1';
      const hint = document.getElementById('newMembreTypeHint');
      hint.textContent = isAp
        ? 'Compté à part des effectifs permanents, uniquement sur les programmes choisis ci-dessous. Intégré définitivement à la base — et pointable partout — dès qu’il est pointé à plus de 6 séances réparties sur au moins 3 programmes.'
        : 'Automatiquement pointable dans tous les programmes déjà créés et ceux à venir.';
      if (progsField) progsField.style.display = isAp ? '' : 'none';
      const extraPermanent = document.getElementById('newMembreExtraPermanent');
      const contactAP = document.getElementById('newMembreContactAP');
      if (extraPermanent) extraPermanent.style.display = isAp ? 'none' : '';
      if (contactAP) contactAP.style.display = isAp ? '' : 'none';
    });
  });
  const addMembre = document.getElementById('addMembreBtn');
  if (addMembre) addMembre.addEventListener('click', async () => {
    const prenom = document.getElementById('newPrenom').value.trim();
    const nom = document.getElementById('newNom').value.trim();
    const sexe = document.getElementById('newSexe').value;
    if (!nom || !prenom) { showToast('Nom et prénom requis'); return; }
    const apBtn = document.querySelector('#newMembreType .status-btn.active');
    const ap = !!(apBtn && apBtn.dataset.ap === '1');
    const extra = {};
    if (ap) {
      const contact = document.getElementById('newMembreContact')?.value.trim();
      if (contact) extra['Contact'] = contact;
    } else {
      document.querySelectorAll('.newMembreExtraInput').forEach(inp => {
        const v = inp.value.trim();
        if (v) extra[inp.dataset.key] = v;
      });
    }
    const sortantSince = isSortant({ extra }) ? todayISO() : null;
    const membre = ap
      ? { id: uid(), nom, prenom, sexe, programmeIds: Array.from(selectedProgs), allProgrammes: false, ap: true, extra, sortantSince }
      : { id: uid(), nom, prenom, sexe, programmeIds: [], allProgrammes: true, ap: false, extra, sortantSince };
    d.membres.push(membre);
    await saveData(); showToast(ap ? 'Membre ponctuel ajouté (AP)' : (sortantSince ? 'Membre ajouté directement dans les Sortants' : 'Membre ajouté — pointable dans tous les programmes')); AppState.render();
  });

  const dz = document.getElementById('dropZone');
  const fileInput = document.getElementById('fileInput');
  if (dz) dz.addEventListener('click', () => fileInput.click());
  if (fileInput) fileInput.addEventListener('change', handleFile);

  const mapSelects = document.querySelectorAll('.mapSelect');
  mapSelects.forEach(sel => sel.addEventListener('change', e => { AppState.importMapping[e.target.dataset.field] = e.target.value; AppState.render(); }));
  const confirmBtn = document.getElementById('confirmImportBtn');
  if (confirmBtn) confirmBtn.addEventListener('click', confirmImport);
  const cancelBtn = document.getElementById('cancelImportBtn');
  if (cancelBtn) cancelBtn.addEventListener('click', () => { AppState.importStep = 0; AppState.render(); });

  const emptyGo = document.getElementById('emptyGoMembres');
  if (emptyGo) emptyGo.addEventListener('click', () => { AppState.tab = 'membres'; AppState.render(); });

  document.querySelectorAll('.delete-prog-btn').forEach(btn => btn.addEventListener('click', () => {
    const prog = d.programmes.find(p => p.id === btn.dataset.id);
    openConfirm(
      'Supprimer ce programme ?',
      '« ' + (prog ? prog.nom : '') + ' » ainsi que toutes ses séances et pointages seront supprimés. Les membres eux-mêmes seront conservés.',
      async () => {
        const sessionIds = d.sessions.filter(s => s.programmeId === btn.dataset.id).map(s => s.id);
        d.sessions = d.sessions.filter(s => s.programmeId !== btn.dataset.id);
        d.pointages = d.pointages.filter(p => !sessionIds.includes(p.sessionId));
        d.membres.forEach(m => { m.programmeIds = m.programmeIds.filter(pid => pid !== btn.dataset.id); });
        d.programmes = d.programmes.filter(p => p.id !== btn.dataset.id);
        await saveData(); showToast('Programme supprimé'); AppState.render();
      }
    );
  }));

  document.querySelectorAll('.member-name-link').forEach(btn => btn.addEventListener('click', () => {
    AppState.memberDetailId = btn.dataset.id;
    AppState.render();
  }));

  document.querySelectorAll('.delete-membre-btn').forEach(btn => btn.addEventListener('click', () => {
    const m = d.membres.find(m => m.id === btn.dataset.id);
    openConfirm(
      'Supprimer ce membre ?',
      (m ? m.prenom + ' ' + m.nom : 'Ce membre') + ' sera retiré, avec tout son historique de pointage.',
      async () => {
        d.pointages = d.pointages.filter(p => p.membreId !== btn.dataset.id);
        d.membres = d.membres.filter(m => m.id !== btn.dataset.id);
        await saveData(); showToast('Membre supprimé'); AppState.render();
      }
    );
  }));

  const resetBtn = document.getElementById('resetAllBtn');
  if (resetBtn) resetBtn.addEventListener('click', () => {
    openConfirm(
      'Réinitialiser toutes les données ?',
      'Programmes, membres, séances et pointages seront définitivement supprimés. Cette action est irréversible.',
      resetAppData,
      'Réinitialiser'
    );
  });

  const clearImportedBtn = document.getElementById('clearImportedDataBtn');
  if (clearImportedBtn) clearImportedBtn.addEventListener('click', () => {
    const count = d.membres.length;
    if (!count) { showToast('Aucun membre à supprimer'); return; }
    openConfirm(
      'Supprimer tous les membres ?',
      `${count} membre${count > 1 ? 's' : ''} et tous les pointages associés seront définitivement supprimés, sur tous les appareils synchronisés. Les programmes et les séances restent intacts. Cette action est irréversible.`,
      async () => {
        const membreIds = new Set(d.membres.map(m => m.id));
        d.pointages = d.pointages.filter(p => !membreIds.has(p.membreId));
        d.membres = [];
        await saveData();
        showToast('Tous les membres ont été supprimés');
      },
      'Supprimer'
    );
  });
}

function handleFile(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    try {
      const wb = XLSX.read(ev.target.result, { type: 'array' });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
      if (!rows.length) { showToast('Fichier vide ou illisible'); return; }
      AppState.importRows = rows;
      AppState.importHeaders = Object.keys(rows[0]);
      AppState.importMapping = guessMapping(AppState.importHeaders);
      AppState.importStep = 1;
      AppState.render();
    } catch (err) { showToast('Impossible de lire ce fichier'); }
  };
  reader.readAsArrayBuffer(file);
}

async function confirmImport() {
  const d = AppState.data;
  const map = AppState.importMapping;
  const required = ['prenom', 'nom'];
  const missing = required.filter(key => !map[key]);
  if (missing.length) {
    showToast('Merci de sélectionner une colonne pour ' + missing.map(k => k === 'prenom' ? 'Prénom' : 'Nom').join(' et '));
    return;
  }
  const selected = Object.values(map).filter(Boolean);
  const duplicates = selected.filter((h, i) => selected.indexOf(h) !== i);
  if (duplicates.length) {
    showToast('Chaque colonne de fichier doit être utilisée au plus une fois dans la correspondance.');
    return;
  }

  const mappedHeaders = new Set(selected);
  let created = 0;

  AppState.importRows.forEach(row => {
    const prenom = (map.prenom ? row[map.prenom] : '') || '';
    const nom = (map.nom ? row[map.nom] : '') || '';
    if (!nom && !prenom) return;
    let sexeRaw = (map.sexe ? String(row[map.sexe]) : '').trim().toLowerCase();
    const sexe = ['f', 'femme', 'female', 'w'].includes(sexeRaw) ? 'F' : 'H';
    // Toute colonne du fichier non utilisée pour prénom/nom/sexe est conservée
    // telle quelle (nom de colonne d'origine → valeur), consultable ensuite
    // dans la fiche détaillée du membre.
    const extra = {};
    Object.keys(row).forEach(h => {
      if (mappedHeaders.has(h)) return;
      const v = row[h];
      if (v === undefined || v === null || String(v).trim() === '') return;
      extra[h] = String(v).trim();
    });
    // Un membre déjà marqué "Sortant" dans le fichier importé entre
    // directement avec ce statut connu (pas de transition à détecter ici,
    // contrairement à une modification manuelle ultérieure).
    const sortantSince = isSortant({ extra }) ? todayISO() : null;
    d.membres.push({ id: uid(), nom: String(nom).trim(), prenom: String(prenom).trim(), sexe, programmeIds: [], allProgrammes: true, extra, sortantSince });
    created++;
  });

  await saveData();
  AppState.importStep = 0; AppState.importRows = []; AppState.importHeaders = []; AppState.importMapping = {};
  showToast(created + ' membre(s) importé(s) — pointables dans tous les programmes');
  AppState.render();
}
