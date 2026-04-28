import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { useTranslation } from '@/lib/i18n';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import {
  Search, Send, Image, Paperclip, Mic, MoreVertical, Archive, Trash2, Eye, EyeOff
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useConversations, useMessages, useSendMessage, useToggleAI, useDeleteMessage, useDeleteConversation, useMarkRead, useArchiveConversation, useSendVoiceMessage, useSendImageMessage, useSendFileMessage } from '@/hooks/use-supabase-data';
import { useVoiceRecorder } from '@/hooks/use-voice-recorder';
import { toast } from 'sonner';
import type { Message } from '@/types';
import { mergeConversationPreviewMessage } from '@/lib/inbox';
import CarouselMessage, { parseCarouselData } from '@/components/CarouselMessage';
import { useInboxRealtime } from '@/hooks/use-inbox-realtime';
import { useIsMobile } from '@/hooks/use-mobile';

const DEFAULT_ATTACHMENT_LABELS = new Set([
  'Image',
  'Video',
  'Voice message',
  'File',
  'Carousel',
  '📷 Image',
  '🎥 Video',
  '🎤 Voice message',
  '📎 File',
  '🎠 Carousel',
  'ðŸ“· Image',
  'ðŸŽ¥ Video',
  'ðŸŽ¤ Voice message',
  'ðŸ“Ž File',
  'ðŸŽ  Carousel',
]);

function shouldHideAttachmentCaption(content?: string | null) {
  const value = (content || '').trim();
  return !value || DEFAULT_ATTACHMENT_LABELS.has(value);
}

const InboxPage = () => {
  const { t } = useTranslation();
  useInboxRealtime();
  const [tab, setTab] = useState('all');
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isMobile = useIsMobile();

  const { data: conversations = [], isLoading: loadingConvos } = useConversations();
  const selected = useMemo(
    () => conversations.find(c => c.id === selectedId) ?? null,
    [conversations, selectedId]
  );
  const { data: chatMessages = [], isLoading: loadingMsgs } = useMessages(selected);
  const sendMessage = useSendMessage();
  const toggleAI = useToggleAI();
  const deleteMessage = useDeleteMessage();
  const deleteConversation = useDeleteConversation();
  const markRead = useMarkRead();
  const archiveConversation = useArchiveConversation();
  const sendVoice = useSendVoiceMessage();
  const sendImage = useSendImageMessage();
  const sendFile = useSendFileMessage();
  const { isRecording, duration, startRecording, stopRecording, cancelRecording } = useVoiceRecorder();

  const handleImageSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !selectedId) return;
    sendImage.mutate({ conversationId: selectedId, file }, {
      onSuccess: () => toast.success('Image sent!'),
      onError: (err: any) => toast.error(err.message || 'Failed to send image'),
    });
    e.target.value = '';
  }, [selectedId, sendImage]);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !selectedId) return;
    sendFile.mutate({ conversationId: selectedId, file }, {
      onSuccess: () => toast.success('File sent!'),
      onError: (err: any) => toast.error(err.message || 'Failed to send file'),
    });
    e.target.value = '';
  }, [selectedId, sendFile]);

  const filtered = useMemo(() => conversations.filter(c => {
    if (tab === 'unread') return c.unreadCount > 0;
    if (tab === 'archived') return c.isArchived;
    return !c.isArchived;
  }).filter(c =>
    !search || c.contactName.toLowerCase().includes(search.toLowerCase()) || c.lastMessage.toLowerCase().includes(search.toLowerCase())
  ), [conversations, tab, search]);

  const displayMessages: Message[] = mergeConversationPreviewMessage(selected, chatMessages);

  useEffect(() => {
    if (!conversations.length) {
      if (selectedId) setSelectedId(null);
      return;
    }

    const selectedStillExists = !!selectedId && conversations.some(conversation => conversation.id === selectedId);

    if (selectedStillExists) return;

    if (isMobile) {
      if (selectedId) setSelectedId(null);
      return;
    }

    const nextConversation = filtered[0] ?? conversations[0];
    if (nextConversation && selectedId !== nextConversation.id) {
      setSelectedId(nextConversation.id);
    }
  }, [conversations, filtered, isMobile, selectedId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [displayMessages.length]);

  const handleSend = () => {
    if (!message.trim() || !selectedId) return;
    sendMessage.mutate({ conversationId: selectedId, content: message });
    setMessage('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const relativeTime = (ts: string) => {
    const diff = Date.now() - new Date(ts).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}m`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h`;
    return `${Math.floor(hrs / 24)}d`;
  };

  return (
    <div className="flex h-[calc(100vh-7rem)] gap-4">
      {/* Left - Conversation List */}
      <Card className={cn("flex flex-col w-full md:w-80 shrink-0", selectedId && "hidden md:flex")}>
        <div className="p-3 border-b border-border">
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList className="w-full">
              <TabsTrigger value="all" className="flex-1">{t('inbox.all')}</TabsTrigger>
              <TabsTrigger value="unread" className="flex-1">{t('inbox.unread')}</TabsTrigger>
              <TabsTrigger value="archived" className="flex-1">{t('inbox.archived')}</TabsTrigger>
            </TabsList>
          </Tabs>
          <div className="relative mt-3">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={search} onChange={e => setSearch(e.target.value)} placeholder={t('inbox.searchConversations')} className="pl-9" />
          </div>
        </div>
        <ScrollArea className="flex-1">
          {loadingConvos ? Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 p-3 border-b border-border">
              <Skeleton className="h-10 w-10 rounded-full" />
              <div className="flex-1 space-y-2"><Skeleton className="h-4 w-24" /><Skeleton className="h-3 w-40" /></div>
            </div>
          )) : filtered.length === 0 ? (
            <p className="p-4 text-center text-sm text-muted-foreground">{t('inbox.noConversations')}</p>
          ) : (
            filtered.map(conv => (
              <button
                key={conv.id}
                onClick={() => setSelectedId(conv.id)}
                className={cn(
                  "flex w-full items-center gap-3 p-3 border-b border-border hover:bg-muted/50 transition-colors text-left",
                  selectedId === conv.id && "bg-accent"
                )}
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">
                  {conv.contactName.charAt(0)}
                </div>
                <div className="flex-1 overflow-hidden">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-foreground truncate">{conv.contactName}</span>
                    <span className="text-[10px] text-muted-foreground shrink-0">{relativeTime(conv.lastMessageTime)}</span>
                  </div>
                  <p className="text-xs text-muted-foreground truncate">{conv.lastMessage}</p>
                </div>
                {conv.unreadCount > 0 && (
                  <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
                    {conv.unreadCount}
                  </span>
                )}
              </button>
            ))
          )}
        </ScrollArea>
      </Card>

      {/* Right - Chat */}
      <Card className={cn("flex flex-1 flex-col", !selectedId && "hidden md:flex")}>
        {!selected ? (
          <div className="flex flex-1 items-center justify-center text-muted-foreground">
            {t('inbox.selectConversation')}
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between border-b border-border p-3">
              <div className="flex items-center gap-3">
                <button className="md:hidden text-foreground" onClick={() => setSelectedId(null)}>←</button>
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">
                  {selected.contactName.charAt(0)}
                </div>
                <span className="font-medium text-foreground">{selected.contactName}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">{t('inbox.aiEnabled')}</span>
                <Switch checked={selected.aiEnabled} onCheckedChange={(checked) => toggleAI.mutate({ conversationId: selected.id, aiEnabled: checked })} className="data-[state=checked]:bg-primary" />
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-8 w-8">
                      <MoreVertical className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => markRead.mutate(selected.id, { onSuccess: () => toast.success('Marked as read') })}><Eye className="mr-2 h-4 w-4" />{t('inbox.markRead')}</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => archiveConversation.mutate({ conversationId: selected.id, archived: !selected.isArchived }, { onSuccess: () => toast.success(selected.isArchived ? 'Unarchived' : 'Archived') })}><Archive className="mr-2 h-4 w-4" />{selected.isArchived ? t('inbox.unarchive') || 'Unarchive' : t('inbox.archive')}</DropdownMenuItem>
                    <DropdownMenuItem className="text-destructive" onClick={() => { deleteConversation.mutate(selected.id, { onSuccess: () => { setSelectedId(null); toast.success('Conversation deleted'); } }); }}><Trash2 className="mr-2 h-4 w-4" />{t('inbox.delete')}</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>

            <ScrollArea className="flex-1 p-4">
              <div className="space-y-3">
                {loadingMsgs ? Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className={cn("flex", i % 2 === 0 ? 'justify-start' : 'justify-end')}>
                    <Skeleton className="h-10 w-48 rounded-2xl" />
                  </div>
                )) : displayMessages.map(msg => {
                  // Determine if this is a carousel message
                  const isCarouselMsg = msg.isCarousel || false;
                  const dbElements = msg.templateElements;
                  const fallbackElements = parseCarouselData(msg.content);
                  const carouselElements = isCarouselMsg && Array.isArray(dbElements) && dbElements.length > 0
                    ? dbElements
                    : fallbackElements;

                  // Bot messages (is_from_bot) show on RIGHT like user messages
                  const isRightSide = msg.sender !== 'contact' || msg.isFromBot;

                  return (
                  <div key={msg.id} className={cn("flex group items-end gap-1", isRightSide ? 'justify-end' : 'justify-start')}>
                    {isRightSide && !msg.id.startsWith('fallback-') && msg.sender !== 'contact' && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
                        onClick={() => {
                          deleteMessage.mutate({ id: msg.id, conversationId: msg.conversationId }, {
                            onSuccess: () => toast.success(t('inbox.messageDeleted') || 'Message deleted'),
                          });
                        }}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    )}
                    <div className={cn(
                      "max-w-[70%] rounded-2xl",
                      carouselElements ? 'px-0 py-0 bg-transparent' : 'px-4 py-2',
                      !carouselElements && (isRightSide ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground')
                    )}>
                      {carouselElements ? (
                        <CarouselMessage elements={carouselElements} />
                      ) : msg.attachmentType === 'template' && !carouselElements ? (
                        (() => {
                          const altCarousel = parseCarouselData(msg.attachmentUrl);
                          if (altCarousel) return <CarouselMessage elements={altCarousel} />;
                          return null;
                        })()
                      ) : null}
                      {!carouselElements && (
                        msg.attachmentType === 'audio' && msg.attachmentUrl ? (
                        <div>
                          <audio controls src={msg.attachmentUrl} className="max-w-full" />
                          {!shouldHideAttachmentCaption(msg.content) && (
                            <p className="text-sm mt-1">{msg.content}</p>
                          )}
                        </div>
                      ) : msg.attachmentType === 'image' && msg.attachmentUrl ? (
                        <div>
                          <img 
                            src={msg.attachmentUrl} 
                            alt="Attachment" 
                            className="max-w-full rounded-lg cursor-pointer" 
                            onClick={() => window.open(msg.attachmentUrl, '_blank')}
                            loading="lazy"
                          />
                          {!shouldHideAttachmentCaption(msg.content) && (
                            <p className="text-sm mt-1">{msg.content}</p>
                          )}
                        </div>
                      ) : msg.attachmentType === 'video' && msg.attachmentUrl ? (
                        <div>
                          <video controls src={msg.attachmentUrl} className="max-w-full rounded-lg" />
                          {!shouldHideAttachmentCaption(msg.content) && (
                            <p className="text-sm mt-1">{msg.content}</p>
                          )}
                        </div>
                      ) : msg.attachmentType === 'file' && msg.attachmentUrl ? (
                        <div>
                          <a href={msg.attachmentUrl} target="_blank" rel="noopener noreferrer" className="underline text-sm flex items-center gap-1">
                            <Paperclip className="h-3 w-3" /> {msg.content || 'File'}
                          </a>
                        </div>
                      ) : msg.attachmentUrl ? (
                        <div>
                          <a href={msg.attachmentUrl} target="_blank" rel="noopener noreferrer" className="underline text-sm">
                            {msg.content || 'Attachment'}
                          </a>
                        </div>
                      ) : (
                        <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                      ))}
                      <div className="flex items-center gap-1 mt-1">
                        {msg.isFromBot && (
                          <span className="text-[9px] opacity-70">🤖</span>
                        )}
                        <p className={cn("text-[10px]",
                          isRightSide ? 'text-primary-foreground/70' : 'text-muted-foreground'
                        )}>
                          {new Date(msg.timestamp).toLocaleTimeString('en-BD', { hour: '2-digit', minute: '2-digit' })}
                        </p>
                      </div>
                    </div>
                  </div>
                  );
                })}
                <div ref={messagesEndRef} />
              </div>
            </ScrollArea>

            <div className="border-t border-border p-3">
              {isRecording && (
                <div className="flex items-center gap-2 mb-2 text-destructive text-sm">
                  <span className="animate-pulse">●</span> {t('inbox.recording')} ({duration}s)
                  <Button size="sm" variant="outline" onClick={async () => {
                    if (!selectedId) return;
                    try {
                      const blob = await stopRecording();
                      sendVoice.mutate({ conversationId: selectedId, audioBlob: blob }, {
                        onSuccess: () => toast.success('Voice message sent!'),
                        onError: (err: any) => toast.error(err.message || 'Failed to send voice'),
                      });
                    } catch (e) { console.error(e); }
                  }}>
                    <Send className="h-3 w-3 mr-1" /> {t('inbox.stop')}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={cancelRecording}>
                    <Trash2 className="h-3 w-3 mr-1" /> Cancel
                  </Button>
                </div>
              )}
              <div className="flex items-end gap-2">
                <div className="flex gap-1">
                  <input ref={imageInputRef} type="file" accept="image/*" className="hidden" onChange={handleImageSelect} />
                  <input ref={fileInputRef} type="file" className="hidden" onChange={handleFileSelect} />
                  <Button variant="ghost" size="icon" className="h-9 w-9 text-muted-foreground" onClick={() => imageInputRef.current?.click()}><Image className="h-4 w-4" /></Button>
                  <Button variant="ghost" size="icon" className="h-9 w-9 text-muted-foreground" onClick={() => fileInputRef.current?.click()}><Paperclip className="h-4 w-4" /></Button>
                  <Button variant="ghost" size="icon" className={cn("h-9 w-9", isRecording ? "text-destructive" : "text-muted-foreground")} onClick={async () => {
                    if (isRecording) {
                      cancelRecording();
                    } else {
                      try { await startRecording(); } catch { toast.error('Microphone access denied'); }
                    }
                  }}><Mic className="h-4 w-4" /></Button>
                </div>
                <Input value={message} onChange={e => setMessage(e.target.value)} onKeyDown={handleKeyDown} placeholder={t('inbox.typeMessage')} className="flex-1" />
                <Button onClick={handleSend} size="icon" className="h-9 w-9 bg-primary text-primary-foreground" disabled={sendMessage.isPending}>
                  <Send className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </>
        )}
      </Card>
    </div>
  );
};

export default InboxPage;
