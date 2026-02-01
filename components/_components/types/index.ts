// User types
export interface User {
    id: string;
    email: string;
    name: string | null;
    role: 'USER' | 'SUPPORT' | 'ADMIN' | 'ADM' | 'VOL';
    createdAt: Date;
    updatedAt: Date;
  }
  
  export interface UserSession {
    id: string;
    email: string;
    name: string | null;
    role: string;
  }
  
  // Workspace types
  export interface WorkspaceConnection {
    id: string;
    userId: string;
    workspaceName: string;
    workspaceUrl: string;
    username: string;
    encryptedPassword: string;
    has2FA: boolean;
    authToken: string | null;
    userId_RC: string | null;
    isActive: boolean;
    lastConnected: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }
  
  export interface WorkspaceFormData {
    workspaceName: string;
    workspaceUrl: string;
    username: string;
    password: string;
    has2FA: boolean;
  }
  
  export interface WorkspacePublic {
    id: string;
    workspaceName: string;
    workspaceUrl: string;
    username: string;
    has2FA: boolean;
    isActive: boolean;
    lastConnected: Date | null;
    createdAt: Date;
  }
  
  // Channel types
  export interface Channel {
    id: string;
    name: string;
    displayName: string;
    type: 'c' | 'p' | 'd'; // c = public channel, p = private group, d = direct message
    messageCount?: number;
    description?: string;
  }
  
  export interface RocketChatChannel {
    _id: string;
    name: string;
    fname?: string;
    t: string;
    msgs?: number;
    description?: string;
  }
  
  // Message types
  export interface ScheduledMessage {
    id: string;
    userId: string;
    workspaceId: string;
    channelId: string;
    channelName: string;
    message: string;
    scheduledFor: Date;
    status: MessageStatus;
    sentAt: Date | null;
    error: string | null;
    createdAt: Date;
    updatedAt: Date;
    workspace?: {
      workspaceName: string;
      workspaceUrl: string;
    };
  }
  
  export type MessageStatus = 'PENDING' | 'SENT' | 'FAILED' | 'CANCELLED';
  
  export interface MessageFormData {
    workspaceId: string;
    channelId: string;
    channelName: string;
    message: string;
    scheduledFor: string; // ISO date string
  }
  
  // API Response types
  export interface ApiResponse<T = any> {
    success: boolean;
    data?: T;
    error?: string;
    message?: string;
  }
  
  export interface LoginResponse {
    success: boolean;
    user: UserSession;
    token: string;
  }
  
  export interface RegisterResponse {
    success: boolean;
    user: UserSession;
    token: string;
  }
  
  export interface WorkspaceResponse {
    success: boolean;
    workspace: WorkspacePublic;
  }
  
  export interface WorkspacesResponse {
    workspaces: WorkspacePublic[];
  }
  
  export interface ChannelsResponse {
    channels: Channel[];
  }
  
  export interface MessagesResponse {
    messages: ScheduledMessage[];
  }
  
  export interface MessageResponse {
    success: boolean;
    message: ScheduledMessage;
  }
  
  export interface TestConnectionResponse {
    success: boolean;
    message: string;
  }
  
  export interface CronJobResponse {
    success: boolean;
    sent: number;
    failed: number;
    timestamp: string;
  }
  
  // Rocket.Chat API types
  export interface RocketChatLoginResponse {
    status: string;
    data?: {
      authToken: string;
      userId: string;
      me?: {
        _id: string;
        username: string;
        name: string;
        emails: Array<{ address: string; verified: boolean }>;
      };
    };
    message?: string;
    error?: string;
  }
  
  export interface RocketChatMessageResponse {
    success: boolean;
    message?: {
      _id: string;
      rid: string;
      msg: string;
      ts: string;
      u: {
        _id: string;
        username: string;
        name: string;
      };
    };
    error?: string;
  }
  
  export interface RocketChatChannelsListResponse {
    channels?: RocketChatChannel[];
    groups?: RocketChatChannel[];
    success: boolean;
    error?: string;
  }
  
  // Form validation types
  export interface LoginFormData {
    email: string;
    password: string;
  }
  
  export interface RegisterFormData {
    email: string;
    password: string;
    confirmPassword: string;
    name?: string;
  }
  
  // Error types
  export interface ApiError {
    error: string;
    details?: string;
    code?: string;
    statusCode?: number;
  }
  
  // Notification types
  export interface Notification {
    message: string;
    type: 'success' | 'error' | 'warning' | 'info';
    duration?: number;
  }
  
  // Pagination types
  export interface PaginationParams {
    page: number;
    limit: number;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
  }
  
  export interface PaginatedResponse<T> {
    data: T[];
    pagination: {
      page: number;
      limit: number;
      total: number;
      totalPages: number;
    };
  }
  
  // Filter types
  export interface MessageFilters {
    workspaceId?: string;
    status?: MessageStatus;
    dateFrom?: Date;
    dateTo?: Date;
  }
  
  // Statistics types
  export interface MessageStatistics {
    total: number;
    pending: number;
    sent: number;
    failed: number;
    cancelled: number;
  }
  
  export interface WorkspaceStatistics {
    totalWorkspaces: number;
    activeWorkspaces: number;
    inactiveWorkspaces: number;
    totalMessages: number;
  }
  
  // Utility types
  export type Optional<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;
  export type RequiredFields<T, K extends keyof T> = T & Required<Pick<T, K>>;
  
  // Environment variables type
  export interface EnvironmentVariables {
    DATABASE_URL: string;
    JWT_SECRET: string;
    CRON_SECRET: string;
    NEXT_PUBLIC_APP_URL: string;
    NODE_ENV: 'development' | 'production' | 'test';
    LOG_LEVEL?: 'debug' | 'info' | 'warn' | 'error';
  }