-- ============================================================
-- Carnet — Membres Sortants
-- À exécuter dans : Supabase → SQL Editor → New query → Run
-- (après supabase-setup.sql ET amphitheatre-setup.sql)
-- Peut être relancé autant de fois que nécessaire sans erreur.
-- ============================================================

-- ------------------------------------------------------------
-- 1) Date à laquelle un membre est devenu "Sortant" (détecté côté
--    client depuis son niveau d'étude importé). Sert à calculer le
--    délai de grâce avant coupure d'accès pour un compte lié.
-- ------------------------------------------------------------
alter table membres add column if not exists sortant_since date;

-- ------------------------------------------------------------
-- 2) Canal de lecture dédié pour un compte "utilisateur" : la table
--    membres lui est inaccessible en lecture directe (RLS réservée à
--    CA/super-admin, cf. amphitheatre-setup.sql section 4). Cette RPC
--    ne renvoie JAMAIS que la ligne du membre auquel le compte
--    appelant est lié (matched_membre_id) — jamais la liste complète.
-- ------------------------------------------------------------
create or replace function public.get_my_membre_info()
returns table(id text, nom text, prenom text, extra jsonb, sortant_since date)
language sql stable security definer set search_path = public as $$
  select m.id, m.nom, m.prenom, m.extra, m.sortant_since
  from public.membres m
  join public.profiles p on p.matched_membre_id = m.id
  where p.id = auth.uid();
$$;

-- ------------------------------------------------------------
-- 3) Blocage d'accès serveur : un compte "utilisateur" lié à un
--    membre devenu "Sortant" depuis 7 jours ou plus perd l'accès aux
--    documents de l'Amphithéâtre (table amphi_documents + Storage),
--    qui sont les seules ressources que ce rôle peut atteindre via
--    can_access_section. N'affecte ni les CA ni les super-admins.
-- ------------------------------------------------------------
create or replace function public.can_access_section(target_section uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_super_admin() or exists (
    select 1 from public.profiles p
    left join public.membres m on m.id = p.matched_membre_id
    where p.id = auth.uid()
      and p.active = true
      and p.section_id = target_section
      and (
        p.role <> 'utilisateur'
        or m.id is null
        or m.sortant_since is null
        or m.sortant_since > (current_date - 7)
      )
  );
$$;
