-- Persist inbound customer text even when an external workflow only updates
-- `conversations.last_message` / `unread_count` and skips `messages` insert.
-- Also suppress likely webhook echo for dashboard-originated messages.

create or replace function public.capture_contact_message_from_conversation()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_old_unread integer := 0;
  v_new_unread integer := coalesce(new.unread_count, 0);
  v_last_message text := trim(coalesce(new.last_message, ''));
  v_last_time timestamptz := coalesce(new.last_message_time, now());
begin
  if tg_op = 'UPDATE' then
    v_old_unread := coalesce(old.unread_count, 0);
  end if;

  -- Only treat unread increment as inbound customer activity.
  if v_new_unread <= v_old_unread then
    return new;
  end if;

  if v_last_message = '' then
    return new;
  end if;

  -- Media placeholders are inserted via dedicated message paths.
  if lower(v_last_message) like '%image%'
     or lower(v_last_message) like '%voice message%'
     or lower(v_last_message) like '%carousel%' then
    return new;
  end if;

  -- Skip if the same inbound text already exists nearby.
  if exists (
    select 1
    from public.messages m
    where m.conversation_id = new.id
      and m.sender = 'contact'
      and trim(coalesce(m.content, '')) = v_last_message
      and m.created_at between v_last_time - interval '3 minutes' and v_last_time + interval '2 minutes'
  ) then
    return new;
  end if;

  -- Skip likely webhook echo of an operator/user message.
  if exists (
    select 1
    from public.messages m
    where m.conversation_id = new.id
      and m.sender = 'user'
      and trim(coalesce(m.content, '')) = v_last_message
      and m.created_at between v_last_time - interval '3 minutes' and v_last_time + interval '2 minutes'
  ) then
    return new;
  end if;

  insert into public.messages (
    conversation_id,
    facebook_id,
    contact_name,
    content,
    sender,
    message_type,
    created_at
  )
  values (
    new.id,
    new.facebook_id,
    new.contact_name,
    v_last_message,
    'contact',
    'text',
    v_last_time
  );

  return new;
end;
$$;

drop trigger if exists trg_capture_contact_message_from_conversation on public.conversations;

create trigger trg_capture_contact_message_from_conversation
after insert or update of last_message, last_message_time, unread_count
on public.conversations
for each row
execute function public.capture_contact_message_from_conversation();
