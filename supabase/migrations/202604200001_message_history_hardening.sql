-- Keep message history tied to the Facebook PSID as well as the conversation id.
-- This makes the dashboard resilient if n8n creates or references a new conversation row.

create index if not exists idx_messages_facebook_created
  on public.messages (facebook_id, created_at)
  where facebook_id is not null;

create or replace function public.fill_message_contact_fields()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_facebook_id text;
  v_contact_name text;
begin
  if new.conversation_id is not null
     and (new.facebook_id is null or new.contact_name is null) then
    select c.facebook_id, c.contact_name
      into v_facebook_id, v_contact_name
    from public.conversations c
    where c.id = new.conversation_id;

    new.facebook_id := coalesce(new.facebook_id, v_facebook_id);
    new.contact_name := coalesce(new.contact_name, v_contact_name);
  end if;

  return new;
end;
$$;

drop trigger if exists trg_fill_message_contact_fields on public.messages;

create trigger trg_fill_message_contact_fields
before insert or update of conversation_id, facebook_id, contact_name
on public.messages
for each row
execute function public.fill_message_contact_fields();

update public.messages m
set
  facebook_id = coalesce(m.facebook_id, c.facebook_id),
  contact_name = coalesce(m.contact_name, c.contact_name)
from public.conversations c
where m.conversation_id = c.id
  and (m.facebook_id is null or m.contact_name is null);
