-- ============================================================
-- Carnet — Compte Visiteur (PF) : lecture seule sur tout, + journal
-- d'observations par Section (visible CA de la Section + super-admin,
-- PF peut écrire/modifier/supprimer ses propres entrées, le CA peut
-- aussi y écrire).
-- À exécuter dans : Supabase → SQL Editor → New query → Run
-- (après tous les patchs précédents)
-- Peut être relancé autant de fois que nécessaire sans erreur.
-- ============================================================

-- ------------------------------------------------------------
-- 1) Nouveau rôle "pf" (visiteur en lecture seule).
-- ------------------------------------------------------------
alter table profiles drop constraint if exists profiles_role_check;
alter table profiles add constraint profiles_role_check
  check (role in ('utilisateur', 'ca', 'super_admin', 'pf'));

create or replace function public.is_pf()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'pf' and active = true);
$$;

-- ------------------------------------------------------------
-- 2) can_access_section() : un compte "pf" a accès à TOUTES les
--    Sections (comme un super-admin), mais ça ne donne QUE de la
--    lecture — voir les policies ci-dessous, qui exigent en plus
--    is_ca_or_admin() pour toute écriture. is_pf() n'apparaît donc
--    jamais dans une condition d'écriture.
-- ------------------------------------------------------------
create or replace function public.can_access_section(target_section uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_super_admin() or public.is_pf() or exists (
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

-- ------------------------------------------------------------
-- 3) Séparation lecture / écriture sur programmes, membres, sessions,
--    pointages : jusqu'ici une seule policy "for all" exigeait
--    can_access_section + is_ca_or_admin() pour TOUT (y compris la
--    lecture). On la scinde pour que "pf" obtienne la lecture (via
--    can_access_section désormais vrai pour lui) sans jamais obtenir
--    l'écriture (toujours réservée à is_ca_or_admin()). Le rôle
--    "utilisateur" reste exclu de la lecture directe de ces tables
--    (inchangé — il passe par get_my_membre_info()).
-- ------------------------------------------------------------
drop policy if exists "section programmes" on programmes;
drop policy if exists "programmes select" on programmes;
create policy "programmes select" on programmes for select
  using (public.can_access_section(section_id) and (public.is_ca_or_admin() or public.is_pf()));
drop policy if exists "programmes insert" on programmes;
create policy "programmes insert" on programmes for insert
  with check (public.can_access_section(section_id) and public.is_ca_or_admin());
drop policy if exists "programmes update" on programmes;
create policy "programmes update" on programmes for update
  using (public.can_access_section(section_id) and public.is_ca_or_admin())
  with check (public.can_access_section(section_id) and public.is_ca_or_admin());
drop policy if exists "programmes delete" on programmes;
create policy "programmes delete" on programmes for delete
  using (public.can_access_section(section_id) and public.is_ca_or_admin());

drop policy if exists "section membres" on membres;
drop policy if exists "membres select" on membres;
create policy "membres select" on membres for select
  using (public.can_access_section(section_id) and (public.is_ca_or_admin() or public.is_pf()));
drop policy if exists "membres insert" on membres;
create policy "membres insert" on membres for insert
  with check (public.can_access_section(section_id) and public.is_ca_or_admin());
drop policy if exists "membres update" on membres;
create policy "membres update" on membres for update
  using (public.can_access_section(section_id) and public.is_ca_or_admin())
  with check (public.can_access_section(section_id) and public.is_ca_or_admin());
drop policy if exists "membres delete" on membres;
create policy "membres delete" on membres for delete
  using (public.can_access_section(section_id) and public.is_ca_or_admin());

drop policy if exists "section sessions" on sessions;
drop policy if exists "sessions select" on sessions;
create policy "sessions select" on sessions for select
  using (public.can_access_section(section_id) and (public.is_ca_or_admin() or public.is_pf()));
drop policy if exists "sessions insert" on sessions;
create policy "sessions insert" on sessions for insert
  with check (public.can_access_section(section_id) and (public.is_ca_or_admin() or public.is_pf()));
drop policy if exists "sessions update" on sessions;
create policy "sessions update" on sessions for update
  using (public.can_access_section(section_id) and public.is_ca_or_admin())
  with check (public.can_access_section(section_id) and public.is_ca_or_admin());
drop policy if exists "sessions delete" on sessions;
create policy "sessions delete" on sessions for delete
  using (public.can_access_section(section_id) and public.is_ca_or_admin());

drop policy if exists "section pointages" on pointages;
drop policy if exists "pointages select" on pointages;
create policy "pointages select" on pointages for select
  using (public.can_access_section(section_id) and (public.is_ca_or_admin() or public.is_pf()));
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

-- Note : amphi_documents n'a pas besoin d'être touchée. Sa policy de
-- lecture ("amphi_documents select") ne dépend que de can_access_section,
-- qui est désormais vraie pour "pf" sur toutes les Sections — la lecture
-- suit donc automatiquement. Ses policies d'écriture exigent déjà
-- is_ca_or_admin() ou d'être l'auteur du dépôt : "pf" ne remplit jamais
-- ces conditions, donc aucun risque d'écriture involontaire.

-- ------------------------------------------------------------
-- 4) Journal d'observations par Section — PF écrit, CA/super-admin
--    lisent et peuvent aussi écrire (échange bidirectionnel). Chacun
--    peut modifier/supprimer ses propres entrées ; le super-admin peut
--    aussi supprimer n'importe quelle entrée (modération).
--
--    Identifiants en "text", pas "uuid" : comme toutes les autres
--    tables synchronisées de l'app (programmes, membres, sessions,
--    pointages, amphi_documents), les lignes sont créées côté client
--    avec un identifiant généré localement (uid()), pas par la base —
--    nécessaire pour que la création fonctionne aussi hors ligne.
-- ------------------------------------------------------------
create table if not exists observations (
  id text primary key,
  section_id uuid not null references sections(id) on delete cascade,
  author_user_id uuid references auth.users(id) on delete set null,
  author_name text not null default '',
  author_role text not null default '',
  content text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Si la table existait déjà avec un id de type uuid (première version de ce
-- patch), on corrige le type de colonne sans perdre les données déjà là.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'observations' and column_name = 'id' and data_type = 'uuid'
  ) then
    alter table observations alter column id drop default;
    alter table observations alter column id type text using id::text;
  end if;
end $$;

alter table observations enable row level security;

drop policy if exists "observations select" on observations;
create policy "observations select" on observations for select
  using (public.can_access_section(section_id) and (public.is_ca_or_admin() or public.is_pf()));

drop policy if exists "observations insert" on observations;
create policy "observations insert" on observations for insert
  with check (
    public.can_access_section(section_id)
    and (public.is_ca_or_admin() or public.is_pf())
    and author_user_id = auth.uid()
  );

drop policy if exists "observations update" on observations;
create policy "observations update" on observations for update
  using (author_user_id = auth.uid())
  with check (author_user_id = auth.uid());

drop policy if exists "observations delete" on observations;
create policy "observations delete" on observations for delete
  using (author_user_id = auth.uid() or public.is_super_admin());
