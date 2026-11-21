begin;

alter table public.reservations
  add column if not exists guest_count integer,
  add column if not exists budget_mga bigint,
  add column if not exists message text;

alter table public.reservations
  add constraint reservations_guest_count
  check (guest_count is null or guest_count between 1 and 20),
  add constraint reservations_budget
  check (budget_mga is null or budget_mga >= 0);

create or replace function public.create_accommodation_request(
  p_accommodation_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_guest_count integer,
  p_budget_mga bigint,
  p_message text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  accommodation public.accommodations%rowtype;
  reservation_id uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'Connectez-vous pour demander une réservation.'
      using errcode = '42501';
  end if;

  if p_starts_at is null or p_ends_at is null or p_ends_at <= p_starts_at then
    raise exception 'Les dates de séjour sont invalides.'
      using errcode = '22023';
  end if;

  if p_starts_at::date <= (now() at time zone 'Indian/Antananarivo')::date then
    raise exception 'La date d’arrivée doit être ultérieure à aujourd’hui.'
      using errcode = '22023';
  end if;

  if p_guest_count is null or p_guest_count between 1 and 20 is not true then
    raise exception 'Le nombre de voyageurs doit être compris entre 1 et 20.'
      using errcode = '22023';
  end if;

  if p_budget_mga is null or p_budget_mga < 0 then
    raise exception 'Le budget doit être positif ou nul.'
      using errcode = '22023';
  end if;

  if length(coalesce(p_message, '')) > 500 then
    raise exception 'Le message ne peut pas dépasser 500 caractères.'
      using errcode = '22023';
  end if;

  select *
  into accommodation
  from public.accommodations
  where id = p_accommodation_id
    and status = 'published'
  for key share;

  if not found then
    raise exception 'Cet hébergement n’est pas publié ou n’est plus disponible.'
      using errcode = 'P0002';
  end;

  insert into public.reservations (
    customer_id,
    partner_id,
    service,
    listing_id,
    status,
    starts_at,
    ends_at,
    guest_count,
    budget_mga,
    message
  )
  values (
    (select auth.uid()),
    accommodation.partner_id,
    'stay',
    accommodation.id,
    'requested',
    p_starts_at,
    p_ends_at,
    p_guest_count,
    p_budget_mga,
    nullif(trim(p_message), '')
  )
  returning id into reservation_id;

  return jsonb_build_object(
    'reservation_id', reservation_id,
    'status', 'requested'
  );
end;
$$;

create or replace function public.respond_accommodation_request(
  p_reservation_id uuid,
  p_confirm boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  request public.reservations%rowtype;
  accommodation public.accommodations%rowtype;
  occupied_units integer := 0;
  available_units integer := 0;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentification requise.'
      using errcode = '42501';
  end if;

  if p_confirm is null then
    raise exception 'La décision du partenaire est invalide.'
      using errcode = '22023';
  end if;

  select *
  into request
  from public.reservations
  where id = p_reservation_id
    and service = 'stay'
  for update;

  if not found then
    raise exception 'Demande introuvable.'
      using errcode = 'P0002';
  end if;

  if not ((select public.owns_partner(request.partner_id)) or (select public.is_admin()))
  then
    raise exception 'Cette demande appartient à un autre partenaire.'
      using errcode = '42501';
  end if;

  if request.status <> 'requested' then
    raise exception 'Cette demande a déjà été traitée.'
      using errcode = 'P0001';
  end if;

  if p_confirm then
    select *
    into accommodation
    from public.accommodations
    where id = request.listing_id
    for update;

    select coalesce(max(avail.units), 0)
    into available_units
    from public.accommodation_availability as avail
    where avail.accommodation_id = request.listing_id
      and avail.available_from <= request.starts_at::date
      and avail.available_to >= request.ends_at::date;

    select count(*)
    into occupied_units
    from public.reservations as other_request
    where other_request.listing_id = request.listing_id
      and other_request.service = 'stay'
      and other_request.status = 'confirmed'
      and other_request.starts_at < request.ends_at
      and other_request.ends_at > request.starts_at;

    if accommodation.status <> 'published'
      or available_units <= occupied_units
    then
      update public.reservations
      set status = 'rejected',
          updated_at = now()
      where id = request.id;

      return jsonb_build_object(
        'reservation_id', request.id,
        'status', 'rejected',
        'reason', 'no_confirmed_availability'
      );
    end if;

    update public.reservations
    set status = 'confirmed',
        updated_at = now()
    where id = request.id;

    return jsonb_build_object(
      'reservation_id', request.id,
      'status', 'confirmed'
    );
  end;

  update public.reservations
  set status = 'rejected',
      updated_at = now()
  where id = request.id;

  return jsonb_build_object(
    'reservation_id', request.id,
    'status', 'rejected'
  );
end;
$$;

revoke all on function public.create_accommodation_request(uuid, timestamptz, timestamptz, integer, bigint, text) from public, anon, authenticated;
revoke all on function public.respond_accommodation_request(uuid, boolean) from public, anon, authenticated;
grant execute on function public.create_accommodation_request(uuid, timestamptz, timestamptz, integer, bigint, text) to authenticated;
grant execute on function public.respond_accommodation_request(uuid, boolean) to authenticated;

commit;
