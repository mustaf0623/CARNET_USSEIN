// views/amphitheatre.js — Onglet Amphithéâtre : dépôt et consultation de
// documents de cours (Supabase Storage), classés par UFR/Filière.
import { AppState, showToast, openConfirm } from '../state.js';
import { AMPHI_TYPE_LABEL, AMPHI_TYPES_WITH_CORRECTION, escapeHtml, uid, fmtDate, todayISO } from '../config.js';
import { saveData } from '../db/data.js';
import { getMemberUfrFiliere, amphiUfrFiliereOptions, isSortant, hasSortantAccessExpired, daysSinceSortant, SORTANT_GRACE_DAYS } from '../domain/membres.js';
import { emptyRow } from '../components/ui.js';
import { submitOrQueueAmphiDocument, retryQueueItem, removeQueueItem } from '../db/upload-queue.js';

// Compte les documents par UFR puis par Filière (pour la vue statistique
// réservée à CA/super-admin). Se base sur TOUS les documents de la Section,
// indépendamment de l'UFR/Filière actuellement affichée.
function computeAmphiStats(d) {
  const byUfr = new Map(); // ufr -> { total, filieres: Map(filiere -> count) }
  (d.amphiDocuments || []).forEach(doc => {
    if (!byUfr.has(doc.ufr)) byUfr.set(doc.ufr, { total: 0, filieres: new Map() });
    const entry = byUfr.get(doc.ufr);
    entry.total++;
    entry.filieres.set(doc.filiere, (entry.filieres.get(doc.filiere) || 0) + 1);
  });
  return Array.from(byUfr.entries())
    .map(([ufr, { total, filieres }]) => ({
      ufr, total,
      filieres: Array.from(filieres.entries()).map(([filiere, count]) => ({ filiere, count })).sort((a, b) => a.filiere.localeCompare(b.filiere)),
    }))
    .sort((a, b) => a.ufr.localeCompare(b.ufr));
}

function renderAmphiStats(d) {
  const stats = computeAmphiStats(d);
  const totalDocs = stats.reduce((sum, u) => sum + u.total, 0);
  return `<div class="card" style="margin-bottom:16px;">
    <h3 class="card-title">Documents par UFR &amp; Filière</h3>
    <div class="card-sub">${totalDocs} document${totalDocs > 1 ? 's' : ''} au total, toutes UFR/Filières confondues</div>
    <div class="ledger">
      ${stats.length ? stats.map(u => `
        <div class="ledger-row">
          <div class="prog-name">${escapeHtml(u.ufr)}</div>
          <span class="pill" style="background:var(--emerald-tint);border-color:var(--emerald);color:var(--emerald-dim);font-weight:700;">${u.total} document${u.total > 1 ? 's' : ''}</span>
        </div>
        <div style="padding:2px 4px 10px 16px;display:flex;flex-wrap:wrap;gap:6px;">
          ${u.filieres.map(f => `<span class="pill">${escapeHtml(f.filiere)} · ${f.count}</span>`).join('')}
        </div>
      `).join('') : emptyRow('Aucun document déposé pour l’instant, dans aucune UFR.')}
    </div>
  </div>`;
}

function renderUploadQueueSection() {
  const mine = (AppState.amphiUploadQueue || []).filter(q => q.uploaderUserId === AppState.sbUser?.id);
  if (!mine.length) return '';
  return `<div class="card" style="margin-bottom:16px;border-color:var(--gold);">
    <h3 class="card-title" style="color:var(--gold);">En attente d’envoi (${mine.length})</h3>
    <div class="card-sub">Ces dépôts seront envoyés automatiquement dès que la connexion revient. Vous pouvez fermer l’app entre-temps : ils sont conservés sur cet appareil.</div>
    <div class="ledger">
      ${mine.map(item => `<div class="ledger-row" style="flex-wrap:wrap;gap:8px;">
        <div style="flex:1;min-width:160px;">
          <div class="prog-name">${escapeHtml(item.titre)} <span class="pill">${AMPHI_TYPE_LABEL[item.type] || item.type}</span></div>
          <div style="font-size:11.5px;color:var(--ink-faint);">${escapeHtml(item.ufr)} — ${escapeHtml(item.filiere)}${item.status === 'error' ? ' · échec : ' + escapeHtml(item.errorMessage || 'réessayez plus tard') : ''}</div>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          ${item.status === 'uploading'
            ? `<span class="pill" style="background:var(--gold-tint);border-color:var(--gold);color:var(--gold);">Envoi en cours…</span>`
            : `<button class="btn btn-ghost btn-sm amphi-queue-retry-btn" data-id="${item.id}">Réessayer</button><button class="btn btn-ghost btn-sm amphi-queue-cancel-btn" data-id="${item.id}" style="color:var(--terracotta);">Annuler</button>`}
        </div>
      </div>`).join('')}
    </div>
  </div>`;
}

export function renderAmphitheatre() {
  const d = AppState.data;
  const isRestricted = AppState.sbProfile?.role === 'utilisateur';

  if (isRestricted) {
    const matched = AppState.myMembreInfo;
    if (matched && isSortant(matched) && hasSortantAccessExpired(matched)) {
      return `<div class="page-head"><div><div class="eyebrow">Amphithéâtre</div><h1 class="page-title">Accès expiré</h1></div></div>
        <div class="card empty-state">
          <p style="margin:0;color:var(--ink-dim);">Votre statut est passé à « Sortant » il y a plus de ${SORTANT_GRACE_DAYS} jours. L’accès à l’Amphithéâtre n’est plus disponible pour ce compte. Contactez un responsable si vous pensez qu’il s’agit d’une erreur.</p>
        </div>`;
    }
  }

  let ufr = AppState.amphiUfr || '';
  let filiere = AppState.amphiFiliere || '';
  if (isRestricted) {
    const info = getMemberUfrFiliere(AppState.myMembreInfo);
    ufr = info.ufr; filiere = info.filiere;
  }
  const options = amphiUfrFiliereOptions(d);
  const graceWarning = (isRestricted && AppState.myMembreInfo && isSortant(AppState.myMembreInfo) && !hasSortantAccessExpired(AppState.myMembreInfo))
    ? (() => {
        const remaining = SORTANT_GRACE_DAYS - daysSinceSortant(AppState.myMembreInfo);
        return `<div style="background:var(--gold-tint);border:1px solid var(--gold);color:var(--gold);border-radius:var(--radius-sm);padding:10px 14px;font-size:12.5px;font-weight:600;margin-bottom:16px;">Votre statut est passé à « Sortant » — l’accès à l’Amphithéâtre sera coupé dans ${remaining} jour${remaining > 1 ? 's' : ''}.</div>`;
      })()
    : '';
  const scopeSelector = !isRestricted ? `
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:16px;">
      <select id="amphiUfrSelect" style="min-width:220px;">
        <option value="">— Choisir UFR / Filière —</option>
        ${options.map(o => `<option value="${escapeHtml(o.ufr)}|||${escapeHtml(o.filiere)}" ${ufr === o.ufr && filiere === o.filiere ? 'selected' : ''}>${escapeHtml(o.ufr)} — ${escapeHtml(o.filiere)}</option>`).join('')}
      </select>
    </div>` : '';

  if (!ufr || !filiere) {
    return `<div class="page-head"><div><div class="eyebrow">Amphithéâtre</div><h1 class="page-title">Documents</h1><p class="page-sub">Cours, TD (avec correction), TP et liens, classés par UFR et Filière.</p></div></div>
      ${renderUploadQueueSection()}
      ${graceWarning}
      ${!isRestricted ? renderAmphiStats(d) : ''}
      ${scopeSelector}
      ${isRestricted ? emptyRow('Votre UFR/Filière n’a pas pu être déterminée depuis la base importée. Contactez un responsable.') : (options.length ? emptyRow('Choisissez une UFR et une Filière ci-dessus.') : emptyRow('Aucune UFR/Filière détectée dans la base importée pour l’instant.'))}
    `;
  }

  const docs = (d.amphiDocuments || []).filter(a => a.ufr === ufr && a.filiere === filiere);
  const q = (AppState.amphiSearch || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const filtered = q ? docs.filter(a => norm(a.reference).includes(q) || norm(a.titre).includes(q)) : docs;
  const canManage = AppState.sbProfile?.role === 'super_admin' || AppState.sbProfile?.role === 'ca';

  return `<div class="page-head"><div><div class="eyebrow">Amphithéâtre</div><h1 class="page-title">${escapeHtml(ufr)} — ${escapeHtml(filiere)}</h1><p class="page-sub">Cours, TD (avec correction si disponible), TP et liens partagés par les membres de cette Filière.</p></div></div>
    ${renderUploadQueueSection()}
    ${graceWarning}
    ${!isRestricted ? renderAmphiStats(d) : ''}
    ${scopeSelector}

    <div class="card">
      <h3 class="card-title">Déposer un document</h3>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;">
        <select id="amphiNewType">
          <option value="cours">Cours</option>
          <option value="td">TD</option>
          <option value="tp">TP</option>
          <option value="devoir">Devoir</option>
          <option value="examen_normale">Examen (session normale)</option>
          <option value="examen_rattrapage">Examen (session rattrapage)</option>
          <option value="lien">Lien</option>
        </select>
        <input type="text" id="amphiNewTitre" placeholder="Titre" style="flex:1;min-width:160px;">
        <input type="text" id="amphiNewReference" placeholder="Référence (pour la recherche)" style="min-width:160px;">
      </div>
      <div id="amphiFileFields" style="margin-top:10px;">
        <input type="file" id="amphiNewFile" accept=".pdf,.doc,.docx,.ppt,.pptx,image/*">
        <div id="amphiCorrectionField" style="margin-top:8px;display:none;">
          <label style="font-size:12px;color:var(--ink-faint);">Correction (optionnelle)</label><br>
          <input type="file" id="amphiCorrectionFile" accept=".pdf,.doc,.docx,.ppt,.pptx,image/*">
        </div>
      </div>
      <div id="amphiLienField" style="margin-top:10px;display:none;">
        <input type="text" id="amphiNewLien" placeholder="https://…" style="width:100%;">
      </div>
      <div style="font-size:11px;color:var(--ink-faint);margin-top:8px;">PDF, Word, PowerPoint acceptés tels quels. Une image est automatiquement convertie en PDF.</div>
      <button class="btn btn-primary" id="amphiUploadBtn" style="margin-top:12px;">Déposer</button>
    </div>

    <div class="card" style="margin-top:16px;">
      <h3 class="card-title">Documents</h3>
      <input type="text" id="amphiSearch" placeholder="Rechercher par référence ou titre…" value="${escapeHtml(AppState.amphiSearch || '')}" style="width:100%;margin:10px 0 14px;">
      <div class="ledger">
        ${filtered.length ? filtered.map(a => `<div class="ledger-row" style="flex-wrap:wrap;gap:8px;">
          <div style="flex:1;min-width:160px;">
            <div class="prog-name">${escapeHtml(a.titre)} <span class="pill">${AMPHI_TYPE_LABEL[a.type] || a.type}</span></div>
            <div style="font-size:11.5px;color:var(--ink-faint);">${a.reference ? 'Réf. ' + escapeHtml(a.reference) + ' · ' : ''}déposé par ${escapeHtml(a.uploaderName || 'inconnu')} · ${fmtDate((a.createdAt || '').slice(0, 10) || todayISO())}</div>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            ${a.type === 'lien' ? `<a class="btn btn-ghost btn-sm" href="${escapeHtml(a.lienUrl)}" target="_blank" rel="noopener">Ouvrir le lien</a>` : `<button class="btn btn-ghost btn-sm amphi-download-btn" data-path="${escapeHtml(a.storagePath)}" data-name="${escapeHtml(a.fileName)}">Télécharger</button>`}
            ${a.correctionStoragePath ? `<button class="btn btn-ghost btn-sm amphi-download-btn" data-path="${escapeHtml(a.correctionStoragePath)}" data-name="${escapeHtml(a.correctionFileName)}">Correction</button>` : ''}
            ${(canManage || a.uploaderUserId === AppState.sbUser?.id) ? `<button class="btn btn-ghost btn-sm amphi-delete-btn" data-id="${a.id}" style="color:var(--terracotta);">Supprimer</button>` : ''}
          </div>
        </div>`).join('') : emptyRow(q ? 'Aucun document ne correspond à cette recherche.' : 'Aucun document pour l’instant.')}
      </div>
    </div>
  `;
}

export function attachAmphitheatreEvents() {
  const d = AppState.data;
  const isRestricted = AppState.sbProfile?.role === 'utilisateur';

  const ufrSel = document.getElementById('amphiUfrSelect');
  if (ufrSel) ufrSel.addEventListener('change', e => {
    const [ufr, filiere] = e.target.value.split('|||');
    AppState.amphiUfr = ufr || ''; AppState.amphiFiliere = filiere || '';
    AppState.render();
  });

  const typeSel = document.getElementById('amphiNewType');
  const toggleFields = () => {
    const t = typeSel ? typeSel.value : 'cours';
    const fileFields = document.getElementById('amphiFileFields');
    const lienField = document.getElementById('amphiLienField');
    const correctionField = document.getElementById('amphiCorrectionField');
    if (fileFields) fileFields.style.display = t === 'lien' ? 'none' : '';
    if (lienField) lienField.style.display = t === 'lien' ? '' : 'none';
    if (correctionField) correctionField.style.display = AMPHI_TYPES_WITH_CORRECTION.includes(t) ? '' : 'none';
  };
  if (typeSel) { typeSel.addEventListener('change', toggleFields); toggleFields(); }

  const searchInput = document.getElementById('amphiSearch');
  if (searchInput) searchInput.addEventListener('input', e => {
    AppState.amphiSearch = e.target.value;
    const pos = e.target.selectionStart;
    AppState.render();
    const again = document.getElementById('amphiSearch');
    if (again) { again.focus(); again.setSelectionRange(pos, pos); }
  });

  const uploadBtn = document.getElementById('amphiUploadBtn');
  if (uploadBtn) uploadBtn.addEventListener('click', async () => {
    if (!AppState.sb || !AppState.sbUser) { showToast('Connexion requise pour déposer un document'); return; }
    let ufr, filiere;
    if (isRestricted) {
      ({ ufr, filiere } = getMemberUfrFiliere(AppState.myMembreInfo));
    } else {
      ufr = AppState.amphiUfr; filiere = AppState.amphiFiliere;
    }
    if (!ufr || !filiere) { showToast('UFR/Filière introuvable'); return; }
    const type = document.getElementById('amphiNewType').value;
    const titre = document.getElementById('amphiNewTitre').value.trim();
    const reference = document.getElementById('amphiNewReference').value.trim();
    if (!titre) { showToast('Indiquez un titre'); return; }

    let file = null, correctionFile = null, lienUrl = '';
    if (type === 'lien') {
      lienUrl = document.getElementById('amphiNewLien').value.trim();
      if (!lienUrl) { showToast('Indiquez un lien'); return; }
    } else {
      const fileInput = document.getElementById('amphiNewFile');
      file = fileInput.files[0];
      if (!file) { showToast('Choisissez un fichier'); return; }
      if (AMPHI_TYPES_WITH_CORRECTION.includes(type)) {
        const corrInput = document.getElementById('amphiCorrectionFile');
        correctionFile = (corrInput && corrInput.files[0]) || null;
      }
    }

    // La signature du dépôt utilise le nom du membre lié par correspondance
    // d'email (prénom + nom tels qu'importés) pour les comptes Amphithéâtre
    // restreints — c'est une identité plus fiable que le profil générique,
    // qui n'est jamais rempli pour ce rôle. Les CA/super-admins déposent
    // sous leur propre nom de signataire, comme pour les rapports.
    let uploaderName;
    if (isRestricted) {
      const matched = AppState.myMembreInfo;
      uploaderName = matched ? `${matched.prenom} ${matched.nom}`.trim() : (AppState.sbProfile?.email || '');
    } else {
      uploaderName = AppState.data.profile.name || AppState.sbProfile?.email || '';
    }

    const item = {
      id: uid(), ufr, filiere, type, titre, reference,
      file, correctionFile, lienUrl,
      uploaderName, uploaderUserId: AppState.sbUser.id,
      sectionId: AppState.activeSectionId,
      createdAt: new Date().toISOString(),
    };

    uploadBtn.disabled = true; uploadBtn.textContent = 'Dépôt en cours…';
    try {
      // Tente l'envoi immédiatement ; si la connexion manque (ou lâche en
      // cours de route), le dépôt est automatiquement mis en attente au
      // lieu d'échouer sans recours — il sera envoyé tout seul à la
      // reconnexion (voir la section "En attente d'envoi" ci-dessus).
      const result = await submitOrQueueAmphiDocument(item);
      showToast(result.queued
        ? 'Pas de connexion — document mis en attente, il sera envoyé automatiquement à la reconnexion'
        : 'Document déposé');
      AppState.render();
    } catch (e) {
      console.error('Carnet — dépôt Amphithéâtre:', e);
      showToast('Échec du dépôt : ' + (e && e.message ? e.message : 'erreur inconnue'));
      uploadBtn.disabled = false; uploadBtn.textContent = 'Déposer';
    }
  });

  document.querySelectorAll('.amphi-queue-retry-btn').forEach(btn => btn.addEventListener('click', () => {
    retryQueueItem(btn.dataset.id);
  }));
  document.querySelectorAll('.amphi-queue-cancel-btn').forEach(btn => btn.addEventListener('click', () => {
    openConfirm('Annuler ce dépôt en attente ?', 'Le document ne sera jamais envoyé et sera retiré de la file d’attente.', () => removeQueueItem(btn.dataset.id), 'Annuler le dépôt');
  }));

  document.querySelectorAll('.amphi-download-btn').forEach(btn => btn.addEventListener('click', async () => {
    const path = btn.dataset.path;
    if (!path) { showToast('Fichier introuvable pour ce document'); return; }
    if (!AppState.sb) { showToast('Connexion requise pour télécharger'); return; }
    // L'onglet doit s'ouvrir de façon SYNCHRONE avec le clic : sur mobile
    // (Safari, PWA installée en particulier), le navigateur associe la
    // permission d'ouvrir un nouvel onglet au geste de l'utilisateur, et
    // cette permission expire dès qu'on passe par un `await`. Si on
    // attendait l'URL signée avant d'ouvrir l'onglet, l'ouverture serait
    // silencieusement bloquée — aucune erreur, le bouton semble "ne pas
    // répondre". On ouvre donc un onglet vide tout de suite, puis on le
    // redirige une fois l'URL obtenue.
    const win = window.open('', '_blank');
    try {
      const { data, error } = await AppState.sb.storage.from('amphi-documents').createSignedUrl(path, 60);
      if (error) throw error;
      if (win && !win.closed) {
        win.location.href = data.signedUrl;
      } else {
        // L'onglet a quand même été bloqué (rare) : on retente une
        // navigation directe dans l'onglet courant.
        const a = document.createElement('a');
        a.href = data.signedUrl; a.download = btn.dataset.name || '';
        document.body.appendChild(a); a.click(); a.remove();
      }
    } catch (e) {
      if (win && !win.closed) win.close();
      showToast('Téléchargement impossible : ' + (e && e.message ? e.message : 'réessayez plus tard'));
    }
  }));

  document.querySelectorAll('.amphi-delete-btn').forEach(btn => btn.addEventListener('click', () => {
    const docItem = (d.amphiDocuments || []).find(a => a.id === btn.dataset.id);
    openConfirm('Supprimer ce document ?', `« ${docItem ? docItem.titre : ''} » sera définitivement supprimé.`, async () => {
      // Suppression DIRECTE et VÉRIFIÉE côté serveur — contrairement au reste
      // de l'app (qui met à jour l'état local puis synchronise en arrière-
      // plan), on ne retire ce document de l'écran QUE si le serveur confirme
      // la suppression. Sinon la ligne resterait affichée indéfiniment sans
      // que l'échec ne soit clairement visible (le document semblerait
      // "supprimé" alors qu'il ne l'est pas réellement en base).
      if (AppState.sb) {
        const { error } = await AppState.sb.from('amphi_documents').delete().eq('id', btn.dataset.id);
        if (error) {
          showToast('Suppression impossible : ' + error.message);
          return;
        }
      }
      const paths = [docItem?.storagePath, docItem?.correctionStoragePath].filter(Boolean);
      if (paths.length && AppState.sb) { try { await AppState.sb.storage.from('amphi-documents').remove(paths); } catch (e) { /* on continue même si le fichier a déjà disparu */ } }
      d.amphiDocuments = (d.amphiDocuments || []).filter(a => a.id !== btn.dataset.id);
      await saveData();
      showToast('Document supprimé'); AppState.render();
    }, 'Supprimer');
  }));
}
