-- ============================================================
-- Carnet — Deux types de comptes PF
-- À exécuter dans Supabase après carnet-pf-observations-patch.sql
-- et carnet-pf-deposit-patch.sql.
-- ============================================================

-- Les anciens comptes "pf" deviennent des PF Conseil : ils conservent
-- exactement leur accès actuel à toutes les Sections.
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('utilisateur', 'ca', 'super_admin', 'pf', 'pf_section', 'pf_conseil'));

update public.profiles
set role = 'pf_conseil'
where role = 'pf';

-- is_pf reste le prédicat commun utilisé par les policies de lecture,
-- d'observations et de dépôt.
create or replace function public.is_pf()
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and active = true
      and role in ('pf', 'pf_section', 'pf_conseil')
  );
$$;

create or replace function public.is_pf_conseil()
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and active = true
      and role in ('pf', 'pf_conseil')
  );
$$;

-- PF Conseil : toutes les Sections.
-- PF de Section : uniquement la Section enregistrée sur son profil.
create or replace function public.can_access_section(target_section uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_super_admin()
    or public.is_pf_conseil()
    or exists (
      select 1
      from public.profiles p
      left join public.membres m on m.id = p.matched_membre_id
      where p.id = auth.uid()
        and p.active = true
        and p.section_id = target_section
        and (
          p.role not in ('utilisateur', 'pf_section')
          or m.id is null
          or m.sortant_since is null
          or m.sortant_since > (current_date - 7)
        )
    );
$$;

-- Attribution administrative des quatre rôles métier. Le membre reste
-- obligatoire pour Utilisateur et facultatif pour les deux types PF.
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
  if new_role not in ('utilisateur', 'ca', 'super_admin', 'pf_section', 'pf_conseil') then
    raise exception 'Rôle invalide';
  end if;
  if new_role in ('utilisateur', 'pf_section') and new_section_id is null then
    raise exception 'Une Section est obligatoire pour ce rôle';
  end if;
  if new_role = 'utilisateur' and new_matched_membre_id is null then
    raise exception 'Choisissez le membre correspondant pour attribuer le rôle Utilisateur';
  end if;
  if new_matched_membre_id is not null and not exists (
    select 1 from public.membres
    where id = new_matched_membre_id
      and section_id = new_section_id
  ) then
    raise exception 'Le membre choisi n''appartient pas à cette Section';
  end if;

  perform set_config('carnet.bypass_profile_guard', 'true', true);
  update public.profiles
  set name = coalesce(
        nullif(trim(name), ''),
        (select nullif(trim(m.prenom || ' ' || m.nom), '')
         from public.membres m
         where m.id = new_matched_membre_id),
        name
      ),
      role = new_role,
      section_id = new_section_id,
      active = new_active,
      matched_membre_id = case
        when new_role in ('utilisateur', 'pf_section', 'pf_conseil') then new_matched_membre_id
        else null
      end
  where id = target_user_id;
  perform set_config('carnet.bypass_profile_guard', 'false', true);
end;
$$;
