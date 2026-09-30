-- ============================================================
-- Carnet — Droit de pointage pour les comptes PF
-- À exécuter après les patchs PF (observations + types).
-- Peut être rejoué sans erreur.
-- ============================================================

-- Les PF peuvent créer une séance dans leur Section accessible.
drop policy if exists "sessions insert" on sessions;
create policy "sessions insert" on sessions for insert
  with check (public.can_access_section(section_id) and (public.is_ca_or_admin() or public.is_pf()));

-- Les PF peuvent enregistrer, modifier ou retirer les statuts
-- présents/absents, mais ne peuvent pas supprimer une séance entière.
drop policy if exists "pointages insert" on pointages;
create policy "pointages insert" on pointages for insert
  with check (public.can_access_section(section_id) and (public.is_ca_or_admin() or public.is_pf()));

drop policy if exists "pointages update" on pointages;
create policy "pointages update" on pointages for update
  using (public.can_access_section(section_id) and (public.is_ca_or_admin() or public.is_pf()))
  with check (public.can_access_section(section_id) and (public.is_ca_or_admin() or public.is_pf()));

drop policy if exists "pointages delete" on pointages;
create policy "pointages delete" on pointages for delete
  using (public.can_access_section(section_id) and (public.is_ca_or_admin() or public.is_pf()));
