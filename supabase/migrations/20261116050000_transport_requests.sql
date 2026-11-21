begin;

alter table public.reservations
  add column transport_snapshot jsonb,
  add constraint reservations_transport_snapshot_object
    check (
      transport_snapshot is null
      or jsonb_typeof(transport_snapshot) = 'object'
    );

alter table public.transport_offers
  add column baggage_details text,
  add column conditions text;

create or replace function public.protect_transport_stock()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user not in ('postgres', 'service_role')
    and not public.is_admin()
    and new.seats_sold is distinct from old.seats_sold
  then
    raise exception 'Le nombre de places vendues ne peut être modifié que par une opération autorisée.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create or replace function public.create_transport_request(
  p_offer_id uuid,
  p_passenger_count integer,
  p_budget_mga bigint,
  p_message text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  offer public.transport_offers%rowtype;
  reservation_id uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'Connectez-vous pour demander ce trajet.'
      using errcode = '42501';
  end if;

  if p_offer_id is null
    or p_passenger_count is null
    or p_passenger_count not between 1 and 20
    or p_budget_mga is null
    or p_budget_mga < 0
    or length(coalesce(p_message, '')) > 500
  then
    raise exception 'Les informations de la demande de trajet sont invalides.'
      using errcode = '22023';
  end if;

  select transport_offers.*
  into offer
  from public.transport_offers
  join public.partners on partners.id = transport_offers.partner_id
  where transport_offers.id = p_offer_id
    and transport_offers.status = 'published'
    and transport_offers.manual_confirmation
    and transport_offers.departure_at is not null
    and transport_offers.departure_at > now()
    and partners.status = 'approved'
  for share of transport_offers, partners;

  if not found then
    raise exception 'Ce trajet n’est pas publié ou n’accepte plus de demandes.'
      using errcode = 'P0002';
  end if;

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
    message,
    transport_snapshot
  )
  values (
    (select auth.uid()),
    offer.partner_id,
    'trip',
    offer.id,
    'requested',
    offer.departure_at,
    offer.estimated_arrival_at,
    p_passenger_count,
    p_budget_mga,
    nullif(trim(p_message), ''),
    jsonb_build_object(
      'operator', offer.operator_name,
      'origin', offer.origin,
      'destination', offer.destination,
      'vehicle', offer.vehicle,
      'baggage_details', offer.baggage_details,
      'conditions', offer.conditions,
      'departure_at', offer.departure_at,
      'estimated_arrival_at', offer.estimated_arrival_at,
      'price_mga', offer.price_mga
    )
  )
  returning id into reservation_id;

  return jsonb_build_object(
    'reservation_id', reservation_id,
    'status', 'requested'
  );
end;
$$;

create or replace function public.respond_transport_request(
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
  offer public.transport_offers%rowtype;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentification requise.'
      using errcode = '42501';
  end if;

  if p_confirm is null then
    raise exception 'La décision du transporteur est invalide.'
      using errcode = '22023';
  end if;

  select *
  into request
  from public.reservations
  where id = p_reservation_id
    and service = 'trip'
  for update;

  if not found then
    raise exception 'Demande de trajet introuvable.'
      using errcode = 'P0002';
  end if;

  if not (
    (select public.owns_partner(request.partner_id))
    or (select public.is_admin())
  ) then
    raise exception 'Cette demande appartient à un autre transporteur.'
      using errcode = '42501';
  end if;

  if request.status <> 'requested' then
    raise exception 'Cette demande a déjà été traitée.'
      using errcode = 'P0001';
  end if;

  select *
  into offer
  from public.transport_offers
  where id = request.listing_id
    and partner_id = request.partner_id
  for update;

  if not found then
    raise exception 'L’offre de transport associée est introuvable.'
      using errcode = 'P0002';
  end if;

  if not p_confirm then
    update public.reservations
    set status = 'rejected',
        updated_at = now()
    where id = request.id;

    return jsonb_build_object(
      'reservation_id', request.id,
      'status', 'rejected'
    );
  end if;

  if offer.status <> 'published'
    or not offer.manual_confirmation
    or not exists (
      select 1
      from public.partners
      where id = offer.partner_id
        and status = 'approved'
    )
    or offer.departure_at is null
    or offer.departure_at <= now()
    or offer.total_seats is null
    or offer.total_seats - offer.seats_sold < request.guest_count
  then
    update public.reservations
    set status = 'rejected',
        updated_at = now()
    where id = request.id;

    return jsonb_build_object(
      'reservation_id', request.id,
      'status', 'rejected',
      'reason', 'transport_capacity_not_confirmed'
    );
  end if;

  update public.transport_offers
  set seats_sold = seats_sold + request.guest_count
  where id = offer.id;

  update public.reservations
  set status = 'confirmed',
      updated_at = now()
  where id = request.id;

  return jsonb_build_object(
    'reservation_id', request.id,
    'status', 'confirmed'
  );
end;
$$;

revoke all on function public.create_transport_request(uuid, integer, bigint, text) from public, anon, authenticated;
revoke all on function public.respond_transport_request(uuid, boolean) from public, anon, authenticated;
grant execute on function public.create_transport_request(uuid, integer, bigint, text) to authenticated;
grant execute on function public.respond_transport_request(uuid, boolean) to authenticated;

commit;
