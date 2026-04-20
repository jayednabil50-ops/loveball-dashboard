import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type {
  Conversation, Message, Order, ErrorLogItem,
  Review, TeamMember, Invoice, ConnectedPageInfo
} from '@/types';

// ---- Conversations ----
export function useConversations() {
  return useQuery({
    queryKey: ['conversations'],
    refetchInterval: 5000,
    refetchOnWindowFocus: true,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('conversations')
        .select('*')
        .order('last_message_time', { ascending: false });
      if (error) throw error;
      return (data || []).map(row => ({
        id: row.id,
        contactName: row.contact_name,
        contactAvatar: row.contact_avatar,
        facebookId: row.facebook_id,
        lastMessage: row.last_message || '',
        lastMessageTime: row.last_message_time,
        unreadCount: row.unread_count || 0,
        isArchived: row.is_archived || false,
        aiEnabled: row.ai_enabled ?? true,
      })) as Conversation[];
    },
  });
}

function mapMessageRow(row: any): Message {
  const isFromBot = row.is_from_bot || false;
  const rawSender = row.sender as 'user' | 'contact' | 'ai';
  const normalizedSender: Message['sender'] =
    rawSender === 'user' && !isFromBot && !!row.facebook_id ? 'contact' : rawSender;

  return {
    id: row.id,
    conversationId: row.conversation_id,
    facebookId: row.facebook_id || undefined,
    contactName: row.contact_name || undefined,
    content: row.content || '',
    sender: normalizedSender,
    timestamp: row.created_at,
    attachmentUrl: row.attachment_url,
    attachmentType: row.attachment_type,
    isCarousel: row.is_carousel || false,
    isFromBot,
    templateElements: row.template_elements || null,
    messageType: row.message_type || 'text',
  };
}

// ---- Messages ----
export function useMessages(conversation: Conversation | null | undefined) {
  const conversationId = conversation?.id ?? null;
  const facebookId = conversation?.facebookId?.trim() || null;

  return useQuery({
    queryKey: ['messages', conversationId, facebookId],
    enabled: !!conversationId,
    refetchInterval: 5000,
    refetchOnWindowFocus: true,
    queryFn: async () => {
      let query = supabase
        .from('messages')
        .select('*');

      query = facebookId
        ? query.or(`conversation_id.eq.${conversationId},facebook_id.eq.${facebookId}`)
        : query.eq('conversation_id', conversationId!);

      const { data, error } = await query
        .order('created_at', { ascending: true })
        .limit(1000);

      if (error) throw error;

      const byId = new Map<string, Message>();
      (data || []).forEach(row => byId.set(row.id, mapMessageRow(row)));

      return Array.from(byId.values()).sort(
        (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
      );
    },
  });
}

async function invokeFacebookSend(payload: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke('facebook-send', {
    body: payload,
  });

  if (error) throw error;
  if (data?.error) throw new Error(data.error);

  return data;
}

async function getConversationFacebookId(conversationId: string) {
  const { data: convo, error } = await supabase
    .from('conversations')
    .select('facebook_id')
    .eq('id', conversationId)
    .single();

  if (error) throw error;
  return convo?.facebook_id as string | null;
}

async function sendFacebookTextMessage(recipientId: string, content: string, conversationId: string) {
  return invokeFacebookSend({
    action: 'send_text',
    recipientId,
    content,
    conversationId,
  });
}

async function sendFacebookAudioMessage(recipientId: string, audioUrl: string, conversationId: string) {
  return invokeFacebookSend({
    action: 'send_audio',
    recipientId,
    audioUrl,
    conversationId,
  });
}

async function sendFacebookImageMessage(recipientId: string, imageUrl: string, conversationId: string) {
  return invokeFacebookSend({
    action: 'send_image',
    recipientId,
    imageUrl,
    conversationId,
  });
}

async function sendFacebookFileMessage(recipientId: string, fileUrl: string, conversationId: string) {
  return invokeFacebookSend({
    action: 'send_file',
    recipientId,
    fileUrl,
    conversationId,
  });
}

export function useSendImageMessage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ conversationId, file }: { conversationId: string; file: File }) => {
      const fileName = `image_${conversationId}_${Date.now()}_${file.name}`;
      const { error: uploadError } = await supabase.storage
        .from('customer-images')
        .upload(fileName, file, { contentType: file.type });
      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage.from('customer-images').getPublicUrl(fileName);
      const publicUrl = urlData.publicUrl;
      const previewText = 'Image';

      const { data, error } = await supabase
        .from('messages')
        .insert({
          conversation_id: conversationId,
          content: previewText,
          sender: 'ai',
          is_from_bot: true,
          message_type: 'image',
          attachment_url: publicUrl,
          attachment_type: 'image',
        })
        .select()
        .single();
      if (error) throw error;

      await supabase
        .from('conversations')
        .update({
          last_message: previewText,
          last_message_time: new Date().toISOString(),
        })
        .eq('id', conversationId);

      const facebookId = await getConversationFacebookId(conversationId);
      if (facebookId) {
        try {
          await sendFacebookImageMessage(facebookId, publicUrl, conversationId);
        } catch (fbErr) {
          console.warn('Facebook image send failed:', fbErr);
        }
      }

      return data;
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['messages', vars.conversationId] });
      qc.invalidateQueries({ queryKey: ['conversations'] });
    },
  });
}

export function useSendFileMessage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ conversationId, file }: { conversationId: string; file: File }) => {
      const fileName = `file_${conversationId}_${Date.now()}_${file.name}`;
      const { error: uploadError } = await supabase.storage
        .from('customer-files')
        .upload(fileName, file, { contentType: file.type });
      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage.from('customer-files').getPublicUrl(fileName);
      const publicUrl = urlData.publicUrl;
      const previewText = `File: ${file.name}`;

      const { data, error } = await supabase
        .from('messages')
        .insert({
          conversation_id: conversationId,
          content: file.name,
          sender: 'ai',
          is_from_bot: true,
          message_type: 'file',
          attachment_url: publicUrl,
          attachment_type: 'file',
        })
        .select()
        .single();
      if (error) throw error;

      await supabase
        .from('conversations')
        .update({
          last_message: previewText,
          last_message_time: new Date().toISOString(),
        })
        .eq('id', conversationId);

      const facebookId = await getConversationFacebookId(conversationId);
      if (facebookId) {
        try {
          await sendFacebookFileMessage(facebookId, publicUrl, conversationId);
        } catch (fbErr) {
          console.warn('Facebook file send failed:', fbErr);
        }
      }

      return data;
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['messages', vars.conversationId] });
      qc.invalidateQueries({ queryKey: ['conversations'] });
    },
  });
}

export function useSendVoiceMessage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ conversationId, audioBlob }: { conversationId: string; audioBlob: Blob }) => {
      const fileName = `voice_${conversationId}_${Date.now()}.webm`;
      const { error: uploadError } = await supabase.storage
        .from('voice-messages')
        .upload(fileName, audioBlob, { contentType: 'audio/webm' });
      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage.from('voice-messages').getPublicUrl(fileName);
      const publicUrl = urlData.publicUrl;
      const previewText = 'Voice message';

      const { data, error } = await supabase
        .from('messages')
        .insert({
          conversation_id: conversationId,
          content: previewText,
          sender: 'ai',
          is_from_bot: true,
          message_type: 'audio',
          attachment_url: publicUrl,
          attachment_type: 'audio',
        })
        .select()
        .single();
      if (error) throw error;

      await supabase
        .from('conversations')
        .update({ last_message: previewText, last_message_time: new Date().toISOString() })
        .eq('id', conversationId);

      const facebookId = await getConversationFacebookId(conversationId);
      if (facebookId) {
        try {
          await sendFacebookAudioMessage(facebookId, publicUrl, conversationId);
        } catch (fbErr) {
          console.warn('Facebook audio send failed (message saved to DB):', fbErr);
        }
      }

      return data;
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['messages', vars.conversationId] });
      qc.invalidateQueries({ queryKey: ['conversations'] });
    },
  });
}

export function useSendMessage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ conversationId, content }: { conversationId: string; content: string }) => {
      const { data, error } = await supabase
        .from('messages')
        .insert({
          conversation_id: conversationId,
          content,
          sender: 'ai',
          is_from_bot: true,
          message_type: 'text',
        })
        .select()
        .single();
      if (error) throw error;

      await supabase
        .from('conversations')
        .update({ last_message: content, last_message_time: new Date().toISOString() })
        .eq('id', conversationId);

      const facebookId = await getConversationFacebookId(conversationId);
      if (facebookId) {
        try {
          await sendFacebookTextMessage(facebookId, content, conversationId);
        } catch (fbErr) {
          console.warn('Facebook send failed (message saved to DB):', fbErr);
        }
      }

      return data;
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['messages', vars.conversationId] });
      qc.invalidateQueries({ queryKey: ['conversations'] });
    },
  });
}

// ---- Orders ----
const ORDER_STATUS_OPTIONS = ['Pending', 'Completed', 'HandedToDeliveryMan'] as const;
type OrderStatusOverride = typeof ORDER_STATUS_OPTIONS[number];

function normalizeOrderStatus(raw: string | null | undefined): Order['status'] {
  const s = (raw || '').trim().toLowerCase();
  if (!s) return 'Pending';
  if (s === 'completed' || s === 'complete' || s === 'delivered' || s === 'done') return 'Completed';
  if (
    s === 'handedtodeliveryman' ||
    s.includes('deliveryman') ||
    s.includes('delivery man') ||
    s.includes('courier')
  ) {
    return 'HandedToDeliveryMan';
  }
  if (s === 'pending') return 'Pending';
  if (s === 'confirmed') return 'Pending';
  if (s === 'cancelled' || s === 'canceled') return 'Cancelled';
  return 'Pending';
}

async function fetchOrderStatusOverrides(): Promise<Map<string, Order['status']>> {
  const { data, error } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', 'order_status_overrides')
    .maybeSingle();

  if (error) {
    console.warn('Order status override fetch failed from app_settings:', error.message);
    return new Map<string, Order['status']>();
  }

  const raw = (data?.value && typeof data.value === 'object') ? data.value as Record<string, string> : {};
  const map = new Map<string, Order['status']>();
  Object.entries(raw).forEach(([orderId, status]) => {
    map.set(orderId, normalizeOrderStatus(status));
  });
  return map;
}

async function fetchOrdersFromDataSource(): Promise<Order[]> {
  const overrides = await fetchOrderStatusOverrides();

  // Primary source: Google Sheet (n8n order flow writes here)
  try {
    const { fetchGoogleSheetOrders } = await import('@/lib/google-sheet');
    const sheetOrders = await fetchGoogleSheetOrders();
    if (sheetOrders.length > 0) {
      return sheetOrders.map(order => ({
        ...order,
        status: overrides.get(order.id) || normalizeOrderStatus(order.status),
      }));
    }
  } catch (sheetError) {
    console.warn('Google Sheet order fetch failed, falling back to Supabase orders table:', sheetError);
  }

  // Fallback source: Supabase orders table
  const { data, error } = await supabase
    .from('orders')
    .select('*')
    .order('order_date', { ascending: false })
    .limit(500);

  if (error) throw error;

  return (data || []).map((row: any) => ({
    id: row.order_id || row.id,
    date: row.order_date ? new Date(row.order_date).toLocaleDateString('en-GB') : '',
    customerName: row.customer_name || 'Unknown',
    customerPhone: row.customer_phone || '',
    address: row.address || '',
    items: Array.isArray(row.items) && row.items.length > 0
      ? row.items
      : [{ name: row.product_name || 'Unknown Product', quantity: row.quantity || 1, unitPrice: Number(row.unit_price) || 0 }],
    amount: Number(row.amount) || 0,
    deliveryFee: row.delivery_fee != null ? Number(row.delivery_fee) : undefined,
    status: overrides.get(row.order_id || row.id) || normalizeOrderStatus(row.status),
    productLink: row.product_link || undefined,
    sku: row.sku || '',
    productSize: row.product_size || '',
  })) as Order[];
}

export function useOrders() {
  return useQuery({
    queryKey: ['orders'],
    refetchInterval: 10000,
    refetchOnWindowFocus: true,
    queryFn: fetchOrdersFromDataSource,
  });
}

export function useUpdateOrderStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ orderId, status }: { orderId: string; status: OrderStatusOverride }) => {
      const { data: existing, error: fetchError } = await supabase
        .from('app_settings')
        .select('value')
        .eq('key', 'order_status_overrides')
        .maybeSingle();
      if (fetchError) throw fetchError;

      const current = (existing?.value && typeof existing.value === 'object')
        ? { ...(existing.value as Record<string, string>) }
        : {};
      current[orderId] = status;

      if (existing) {
        const { error } = await supabase
          .from('app_settings')
          .update({ value: current })
          .eq('key', 'order_status_overrides');
        if (error) throw error;
        return;
      }

      const { error } = await supabase
        .from('app_settings')
        .insert({
          key: 'order_status_overrides',
          value: current,
        });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['orders'] });
    },
  });
}
// ---- Error Logs ----
export function useErrorLogs() {
  return useQuery({
    queryKey: ['error_logs'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('error_logs')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data || []).map(row => ({
        id: row.id,
        type: row.type,
        message: row.message,
        timestamp: row.created_at,
        context: row.context,
        stack: row.stack,
      })) as ErrorLogItem[];
    },
  });
}

export function useDeleteErrorLog() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('error_logs').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['error_logs'] }),
  });
}

export function useDeleteAllErrorLogs() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('error_logs').delete().neq('id', '');
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['error_logs'] }),
  });
}

// ---- Reviews ----
export function useReviews() {
  return useQuery({
    queryKey: ['reviews'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('reviews')
        .select('*')
        .order('review_date', { ascending: false });
      if (error) throw error;
      return (data || []).map(row => ({
        id: row.id,
        customerName: row.customer_name,
        rating: row.rating,
        comment: row.comment || '',
        date: row.review_date,
      })) as Review[];
    },
  });
}

// ---- Team ----
export function useTeam() {
  return useQuery({
    queryKey: ['team_members'],
    queryFn: async () => {
      const { data, error } = await supabase.from('team_members').select('*');
      if (error) throw error;
      return (data || []).map(row => ({
        id: row.id,
        name: row.name,
        email: row.email,
        role: row.role as TeamMember['role'],
        avatar: row.avatar,
      })) as TeamMember[];
    },
  });
}

export function useInviteTeam() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ email, role }: { email: string; role: string }) => {
      const { error } = await supabase.from('team_members').insert({ name: email.split('@')[0], email, role });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['team_members'] }),
  });
}

// ---- Invoices ----
export function useInvoices() {
  return useQuery({
    queryKey: ['invoices'],
    queryFn: async () => {
      const { data, error } = await supabase.from('invoices').select('*').order('invoice_date', { ascending: false });
      if (error) throw error;
      return (data || []).map(row => ({
        id: row.id,
        date: row.invoice_date,
        amount: Number(row.amount),
        status: row.status as Invoice['status'],
      })) as Invoice[];
    },
  });
}

// ---- AI Settings ----
export function useAISettings() {
  return useQuery({
    queryKey: ['ai_settings'],
    queryFn: async () => {
      const { data, error } = await supabase.from('ai_settings').select('*').limit(1).single();
      if (error && error.code !== 'PGRST116') throw error;
      return data ? { aiName: data.ai_name, instructions: data.instructions || '', aiActive: data.ai_active } : { aiName: 'ShopBot AI', instructions: '', aiActive: true };
    },
  });
}

export function useSaveAISettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ aiName, instructions }: { aiName: string; instructions: string }) => {
      // Try update first, then insert
      const { data: existing } = await supabase.from('ai_settings').select('id').limit(1).single();
      if (existing) {
        const { error } = await supabase.from('ai_settings').update({ ai_name: aiName, instructions, updated_at: new Date().toISOString() }).eq('id', existing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('ai_settings').insert({ ai_name: aiName, instructions });
        if (error) throw error;
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ai_settings'] }),
  });
}

export function useSetGlobalAIActive() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (aiActive: boolean) => {
      const { data: existing, error: existingError } = await supabase
        .from('ai_settings')
        .select('id')
        .limit(1)
        .maybeSingle();

      if (existingError) throw existingError;

      if (existing?.id) {
        const { error } = await supabase
          .from('ai_settings')
          .update({ ai_active: aiActive, updated_at: new Date().toISOString() })
          .eq('id', existing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('ai_settings')
          .insert({ ai_name: 'ShopBot AI', instructions: '', ai_active: aiActive });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ai_settings'] });
      qc.invalidateQueries({ queryKey: ['dashboard_summary'] });
    },
  });
}

// ---- Connected Page ----
export function useConnectedPage() {
  return useQuery({
    queryKey: ['connected_pages'],
    queryFn: async () => {
      const [{ data: pageData, error: pageErr }, { data: appSettings, error: appErr }] = await Promise.all([
        supabase.from('connected_pages').select('*').limit(1).single(),
        supabase.from('app_settings').select('key,value').in('key', ['facebook_page_access_token', 'facebook_verify_token']),
      ]);
      if (pageErr && pageErr.code !== 'PGRST116') throw pageErr;
      if (appErr) throw appErr;
      const settingsMap = Object.fromEntries((appSettings || []).map((r: any) => [r.key, r.value]));
      const token = (settingsMap.facebook_page_access_token || '').toString();
      if (!pageData) {
        return {
          webhookUrl: '',
          status: 'disconnected',
          pageName: '',
          pageId: '',
          connectedOn: '',
          hasAccessToken: token.length > 0,
          verifyToken: (settingsMap.facebook_verify_token || '').toString(),
        } as ConnectedPageInfo;
      }
      return {
        webhookUrl: pageData.webhook_url || '',
        status: pageData.status as ConnectedPageInfo['status'],
        pageName: pageData.page_name || '',
        pageId: pageData.page_id || '',
        connectedOn: pageData.connected_on || '',
        hasAccessToken: token.length > 0,
        verifyToken: (settingsMap.facebook_verify_token || '').toString(),
      } as ConnectedPageInfo;
    },
  });
}
export function useSaveFacebookConnection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      pageId: string;
      pageName: string;
      pageAccessToken?: string;
      webhookUrl: string;
      verifyToken?: string;
    }) => {
      return invokeFacebookSend({
        action: 'update_config',
        ...payload,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['connected_pages'] });
      qc.invalidateQueries({ queryKey: ['app_settings', 'webhook'] });
    },
  });
}
export function useTestFacebookConnection() {
  return useMutation({
    mutationFn: async (payload?: { pageId?: string; pageAccessToken?: string }) => {
      return invokeFacebookSend({
        action: 'test_connection',
        ...payload,
      });
    },
  });
}
// ---- App Settings (profile, notifications, webhook) ----
export function useAppSetting(key: string) {
  return useQuery({
    queryKey: ['app_settings', key],
    queryFn: async () => {
      const { data, error } = await supabase.from('app_settings').select('value').eq('key', key).maybeSingle();
      if (error) throw error;
      return data?.value || null;
    },
  });
}

export function useSaveAppSetting() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ key, value }: { key: string; value: any }) => {
      const { error } = await supabase.from('app_settings').upsert({ key, value, updated_at: new Date().toISOString() });
      if (error) throw error;
    },
    onSuccess: (_, vars) => qc.invalidateQueries({ queryKey: ['app_settings', vars.key] }),
  });
}

// ---- Dashboard Summary (aggregated) ----
export function useDashboardSummary() {
  return useQuery({
    queryKey: ['dashboard_summary'],
    refetchInterval: 5000,
    refetchOnWindowFocus: true,
    queryFn: async () => {
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);
      const startOfDayIso = startOfDay.toISOString();
      
      const [convRes, aiRes, messageCountRes, sheetOrders] = await Promise.all([
        supabase.from('conversations').select('id, unread_count, last_message_time', { count: 'exact' }),
        supabase.from('ai_settings').select('ai_name, ai_active').limit(1).maybeSingle(),
        supabase.from('messages').select('id', { count: 'exact', head: true }).gte('created_at', startOfDayIso),
        fetchOrdersFromDataSource().catch(() => [] as Order[]),
      ]);

      const conversations = convRes.data || [];
      const todayRevenue = sheetOrders.reduce((s, o) => s + o.amount, 0);
      const fallbackTodayMessages = conversations.filter(
        conversation => !!conversation.last_message_time && conversation.last_message_time >= startOfDayIso,
      ).length;
      const todayMessages = messageCountRes.count ?? fallbackTodayMessages;

      return {
        todayMessages,
        activeConversations: conversations.filter(c => (c.unread_count || 0) > 0).length,
        orders: sheetOrders.length,
        todayRevenue,
        aiName: aiRes.data?.ai_name || 'ShopBot AI',
        aiActive: aiRes.data?.ai_active ?? true,
        plan: 'Pro',
      };
    },
  });
}

export function useDeleteMessage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, conversationId }: { id: string; conversationId: string }) => {
      const { error } = await supabase.from('messages').delete().eq('id', id);
      if (error) throw error;
      return conversationId;
    },
    onSuccess: (conversationId) => {
      qc.invalidateQueries({ queryKey: ['messages', conversationId] });
    },
  });
}

export function useDeleteConversation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (conversationId: string) => {
      // Delete all messages first, then the conversation
      const { error: msgErr } = await supabase.from('messages').delete().eq('conversation_id', conversationId);
      if (msgErr) throw msgErr;
      const { error: convErr } = await supabase.from('conversations').delete().eq('id', conversationId);
      if (convErr) throw convErr;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['conversations'] });
    },
  });
}

export function useMarkRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (conversationId: string) => {
      const { error } = await supabase.from('conversations').update({ unread_count: 0 }).eq('id', conversationId);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['conversations'] }),
  });
}

export function useArchiveConversation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ conversationId, archived }: { conversationId: string; archived: boolean }) => {
      const { error } = await supabase.from('conversations').update({ is_archived: archived }).eq('id', conversationId);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['conversations'] }),
  });
}

export function useToggleAI() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ conversationId, aiEnabled }: { conversationId: string; aiEnabled: boolean }) => {
      const { error } = await supabase
        .from('conversations')
        .update({ ai_enabled: aiEnabled })
        .eq('id', conversationId);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['conversations'] }),
  });
}

// ---- Real Trend Data ----
export function useMessageTrend(days: number = 7) {
  return useQuery({
    queryKey: ['message_trend', days],
    queryFn: async () => {
      const points: { date: string; incoming: number; outgoing: number }[] = [];
      for (let i = days - 1; i >= 0; i--) {
        const dayStart = new Date();
        dayStart.setDate(dayStart.getDate() - i);
        dayStart.setHours(0, 0, 0, 0);
        const dayEnd = new Date(dayStart);
        dayEnd.setHours(23, 59, 59, 999);
        const label = dayStart.toLocaleDateString('en-BD', { day: 'numeric', month: 'short' });

        const [incoming, outgoing] = await Promise.all([
          supabase.from('messages').select('id', { count: 'exact', head: true })
            .eq('sender', 'contact').gte('created_at', dayStart.toISOString()).lte('created_at', dayEnd.toISOString()),
          supabase.from('messages').select('id', { count: 'exact', head: true })
            .in('sender', ['user', 'ai']).gte('created_at', dayStart.toISOString()).lte('created_at', dayEnd.toISOString()),
        ]);
        points.push({ date: label, incoming: incoming.count || 0, outgoing: outgoing.count || 0 });
      }
      return points;
    },
  });
}

export function useOrderTrend(days: number = 7) {
  return useQuery({
    queryKey: ['order_trend', days],
    queryFn: async () => {
      const orders = await fetchOrdersFromDataSource();
      const points: { date: string; orders: number; revenue: number }[] = [];
      for (let i = days - 1; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const label = d.toLocaleDateString('en-BD', { day: 'numeric', month: 'short' });
        const dateStr = d.toLocaleDateString('en-GB');
        const dayOrders = orders.filter(o => o.date === dateStr);
        points.push({ date: label, orders: dayOrders.length, revenue: dayOrders.reduce((s, o) => s + o.amount, 0) });
      }
      return points;
    },
  });
}

export function useOrderStatusDistribution() {
  return useQuery({
    queryKey: ['order_status_dist'],
    queryFn: async () => {
      const orders = await fetchOrdersFromDataSource();
      const counts: Record<string, number> = { Pending: 0, Completed: 0, HandedToDeliveryMan: 0, Cancelled: 0 };
      orders.forEach(o => { counts[o.status] = (counts[o.status] || 0) + 1; });
      const colorMap: Record<string, string> = {
        Pending: 'hsl(38, 92%, 50%)',
        Completed: 'hsl(160, 84%, 32%)',
        HandedToDeliveryMan: 'hsl(217, 91%, 50%)',
        Cancelled: 'hsl(0, 84%, 60%)',
      };
      return Object.entries(counts).map(([name, value]) => ({ name, value, color: colorMap[name] }));
    },
  });
}


