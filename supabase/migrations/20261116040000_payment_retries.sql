begin;

alter table public.payment_intents
  drop constraint if exists payment_intents_order_id_key;

create index if not exists payment_intents_order_created_idx
  on public.payment_intents (order_id, created_at desc);

create or replace function public.prepare_papi_payment(
  p_order_id uuid,
  p_customer_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  ticket_order public.orders%rowtype;
  intent public.payment_intents%rowtype;
  intent_id uuid := gen_random_uuid();
begin
  if current_user not in ('postgres', 'service_role') then
    raise exception 'Cette opération est réservée au serveur de paiement.'
      using errcode = '42501';
  end if;

  if p_order_id is null or p_customer_id is null then
    raise exception 'La commande ou le client est invalide.'
      using errcode = '22023';
  end if;

  perform public.release_expired_ticket_holds();
  select * into ticket_order
  from public.orders
  where id = p_order_id
  for update;

  if not found or ticket_order.user_id <> p_customer_id then
    raise exception 'Commande introuvable.'
      using errcode = 'P0002';
  end if;

  if ticket_order.status <> 'pending'
    or ticket_order.hold_expires_at <= now()
  then
    raise exception 'La commande n’est plus payable ; vérifiez son statut dans votre compte.'
      using errcode = 'P0001';
  end if;

  if ticket_order.gross_amount_mga < 300 then
    raise exception 'Le montant minimum accepté par Papi est de 300 MGA.'
      using errcode = '22023';
  end if;

  update public.payment_intents
  set status = 'cancelled',
      updated_at = now()
  where order_id = p_order_id
    and status = 'pending'
    and link_expires_at <= now();

  select * into intent
  from public.payment_intents
  where order_id = p_order_id
    and status = 'pending'
  order by created_at desc
  limit 1;

  if found then
    return jsonb_build_object(
      'payment_id', intent.id,
      'merchant_reference', intent.merchant_reference,
      'amount_mga', intent.amount_mga,
      'checkout_url', intent.checkout_url,
      'link_expires_at', intent.link_expires_at
    );
  end if;

  insert into public.payment_intents (
    id,
    order_id,
    customer_id,
    merchant_reference,
    amount_mga
  )
  values (
    intent_id,
    p_order_id,
    p_customer_id,
    'EVENTORA-' || replace(intent_id::text, '-', ''),
    ticket_order.gross_amount_mga
  )
  returning * into intent;

  return jsonb_build_object(
    'payment_id', intent.id,
    'merchant_reference', intent.merchant_reference,
    'amount_mga', intent.amount_mga,
    'checkout_url', null,
    'link_expires_at', null
  );
end;
$$;

create or replace function public.get_papi_payment_intent(
  p_order_id uuid,
  p_customer_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  intent public.payment_intents%rowtype;
begin
  if current_user not in ('postgres', 'service_role') then
    raise exception 'Cette opération est réservée au serveur de paiement.'
      using errcode = '42501';
  end if;

  perform public.release_expired_ticket_holds();

  select * into intent
  from public.payment_intents
  where order_id = p_order_id
    and customer_id = p_customer_id
  order by (status = 'succeeded') desc, created_at desc
  limit 1;

  if not found then
    raise exception 'Intention de paiement introuvable.'
      using errcode = 'P0002';
  end if;

  return jsonb_build_object(
    'payment_id', intent.id,
    'order_id', intent.order_id,
    'merchant_reference', intent.merchant_reference,
    'notification_token', intent.notification_token,
    'provider_reference', intent.provider_reference,
    'amount_mga', intent.amount_mga,
    'currency', intent.currency,
    'checkout_url', intent.checkout_url,
    'status', intent.status
  );
end;
$$;

create or replace function public.process_papi_notification(
  p_merchant_reference text,
  p_notification_token text,
  p_payment_status text,
  p_provider_payment_reference text,
  p_amount_mga bigint,
  p_currency text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  intent public.payment_intents%rowtype;
  ticket_order public.orders%rowtype;
  target_order_id uuid;
  order_result jsonb;
begin
  if current_user not in ('postgres', 'service_role') then
    raise exception 'Cette opération est réservée au serveur de paiement.'
      using errcode = '42501';
  end if;

  if p_merchant_reference is null
    or p_notification_token is null
    or p_payment_status is null
    or p_payment_status not in ('SUCCESS', 'FAILED', 'PENDING')
    or p_amount_mga is null
    or p_currency is null
    or p_currency <> 'MGA'
    or (p_payment_status = 'SUCCESS' and coalesce(p_provider_payment_reference, '') = '')
  then
    raise exception 'Notification Papi invalide.'
      using errcode = '22023';
  end if;

  select order_id into target_order_id
  from public.payment_intents
  where merchant_reference = p_merchant_reference;

  if not found then
    raise exception 'Référence ou jeton de notification inconnu.'
      using errcode = '42501';
  end if;

  select * into ticket_order
  from public.orders
  where id = target_order_id
  for update;

  if not found then
    raise exception 'Commande introuvable.'
      using errcode = 'P0002';
  end if;

  select * into intent
  from public.payment_intents
  where merchant_reference = p_merchant_reference
  for update;

  if not found
    or intent.notification_token is null
    or intent.notification_token <> p_notification_token
  then
    raise exception 'Référence ou jeton de notification inconnu.'
      using errcode = '42501';
  end if;

  if p_amount_mga <> intent.amount_mga then
    raise exception 'Le montant notifié ne correspond pas au montant attendu.'
      using errcode = '22023';
  end if;

  if intent.status = 'succeeded' then
    if p_payment_status = 'SUCCESS'
      and intent.provider_reference is distinct from p_provider_payment_reference
    then
      order_result := public.confirm_paid_ticket_order(
        intent.order_id,
        'Papi',
        p_provider_payment_reference,
        p_amount_mga
      );

      return order_result || jsonb_build_object(
        'duplicate', false,
        'additional_payment', true
      );
    end if;

    return jsonb_build_object(
      'status', 'succeeded',
      'duplicate', true,
      'order_id', intent.order_id
    );
  end if;

  if p_payment_status = 'SUCCESS' then
    order_result := public.confirm_paid_ticket_order(
      intent.order_id,
      'Papi',
      p_provider_payment_reference,
      p_amount_mga
    );

    update public.payment_intents
    set status = 'succeeded',
        provider_reference = p_provider_payment_reference,
        updated_at = now()
    where id = intent.id;

    return order_result || jsonb_build_object('duplicate', false);
  end if;

  update public.payment_intents
  set status = case
        when p_payment_status = 'FAILED' then 'failed'::public.payment_status
        else 'pending'::public.payment_status
      end,
      updated_at = now()
  where id = intent.id;

  return jsonb_build_object(
    'status', lower(p_payment_status),
    'order_id', intent.order_id,
    'duplicate', false
  );
end;
$$;

commit;
