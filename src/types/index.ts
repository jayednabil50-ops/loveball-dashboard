export interface DashboardSummary {
  todayMessages: number;
  activeConversations: number;
  orders: number;
  todayRevenue: number;
  aiName: string;
  aiActive: boolean;
  plan: string;
}

export interface AISettings {
  aiName: string;
  instructions: string;
}

export interface ConnectedPageInfo {
  webhookUrl: string;
  status: 'connected' | 'disconnected';
  pageName: string;
  pageId: string;
  connectedOn: string;
  hasAccessToken?: boolean;
  verifyToken?: string;
}

export interface Conversation {
  id: string;
  contactName: string;
  contactAvatar?: string;
  facebookId: string;
  lastMessage: string;
  lastMessageTime: string;
  unreadCount: number;
  isArchived: boolean;
  aiEnabled: boolean;
}

export interface Message {
  id: string;
  conversationId: string;
  facebookId?: string;
  contactName?: string;
  content: string;
  sender: 'user' | 'contact' | 'ai';
  timestamp: string;
  attachmentUrl?: string;
  attachmentType?: string;
  isCarousel?: boolean;
  isFromBot?: boolean;
  templateElements?: any[];
  messageType?: string;
}

export interface Order {
  id: string;
  date: string;
  customerName: string;
  customerPhone: string;
  address?: string;
  items: { name: string; quantity?: number; unitPrice?: number }[];
  amount: number;
  deliveryFee?: number;
  status: 'Delivered' | 'Confirmed' | 'Pending' | 'Cancelled';
  productLink?: string;
  sku?: string;
  productSize?: string;
}

export interface AnalyticsSummary {
  totalMessages: number;
  incomingMessages: number;
  outgoingMessages: number;
  avgResponseRate: number;
  totalRevenue: number;
  avgDailyRevenue: number;
  customerSatisfaction: number;
}

export interface TrendPoint {
  date: string;
  incoming?: number;
  outgoing?: number;
  orders?: number;
  revenue?: number;
}

export interface Distribution {
  name: string;
  value: number;
  color: string;
}

export interface UserProfile {
  name: string;
  email: string;
  phone: string;
  avatar?: string;
}

export interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: 'Admin' | 'Editor' | 'Viewer';
  avatar?: string;
}

export interface Invoice {
  id: string;
  date: string;
  amount: number;
  status: 'Paid' | 'Pending';
}

export interface ErrorLogItem {
  id: string;
  type: string;
  message: string;
  timestamp: string;
  context?: string;
  stack?: string;
}

export interface NotificationSettings {
  emailAlerts: boolean;
  errorAlerts: boolean;
  dailySummary: boolean;
}

export interface Review {
  id: string;
  customerName: string;
  rating: number;
  comment: string;
  date: string;
}
