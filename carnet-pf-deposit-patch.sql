-- ============================================================
-- Carnet — Droit de dépôt Amphithéâtre pour le Visiteur (PF)
-- + rattachement optionnel à un membre (détection du niveau d'étude)
-- À exécuter dans : Supabase → SQL Editor → New query → Run
-- Peut être relancé autant de fois que nécessaire sans erreur.
-- ============================================================

-- ------------------------------------------------------------
-- Aucun changement de policy RLS n'est nécessaire ici : les policies
-- d'insertion sur amphi_documents et le bucket de stockage n'exigent déjà
-- que can_access_section(section_id) + uploader_user_id = auth.uid() (pas
-- is_ca_or_admin()) — et can_access_section renvoie déjà vrai pour "pf" sur
-- toutes les Sections. Le dépôt et la suppression de ses propres documents
-- fonctionnent donc déjà côté serveur dès que le client cesse de masquer
-- le formulaire pour ce rôle.
-- ------------------------------------------------------------

-- ------------------------------------------------------------
-- Seul changement nécessaire : permettre de lier optionnellement un
-- compte "pf" à un membre de la base importée (comme "utilisateur", mais
-- facultatif ici) — sert uniquement à suggérer son niveau d'étude au
-- moment d'un dépôt, jamais à restreindre son accès en lecture.
-- ------------------------------------------------------------
create or replace function public.admin_assign_role(
  target_user_id uuid,
  new_role text,
  new_section_id uuid,
  new_active boolean,
  new_matched_membre_id text default null
)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_super_admin() then
    raise exception 'Seul un super-administrateur peut modifier les droits d''un compte';
  end if;
  if target_user_id = auth.uid() then
    raise exception 'Vous ne pouvez pas modifier votre propre rôle ou statut actif — demandez à un autre super-administrateur';
  end if;
  if new_role = 'utilisateur' and new_matched_membre_id is null then
    raise exception 'Choisissez le membre correspondant pour attribuer le rôle Utilisateur';
  end if;
  if new_matched_membre_id is not null and not exists (
    select 1 from public.membres where id = new_matched_membre_id and section_id = new_section_id
  ) then
    raise exception 'Le membre choisi n''appartient pas à cette Section';
  end if;

  perform set_config('carnet.bypass_profile_guard', 'true', true);
  update public.profiles
  set role = new_role,
      section_id = new_section_id,
      active = new_active,
      -- Le rattachement à un membre est OBLIGATOIRE pour "utilisateur"
      -- (UFR/Filière en dépendent) et FACULTATIF pour "pf" (permet juste de
      -- retrouver son niveau d'étude s'il figure dans la base importée) ;
      -- effacé pour les autres rôles afin d'éviter une référence obsolète.
      matched_membre_id = case when new_role in ('utilisateur', 'pf') then new_matched_membre_id else null end
  where id = target_user_id;
  perform set_config('carnet.bypass_profile_guard', 'false', true);
end;
$$;
