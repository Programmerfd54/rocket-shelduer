import { RocketChatApiError } from '@/lib/rc-api-error';
// Все запросы к Rocket.Chat идут через safeFetch: SSRF-проверка URL (включая DNS и редиректы),
// токены RC не пересылаются на другой origin при редиректе.
import { safeFetch as fetch } from '@/lib/ssrf';

interface RocketChatLoginResponse {
    status: string;
    data?: {
      authToken: string;
      userId: string;
    };
    message?: string;
  }
  
  interface RocketChatChannel {
    _id: string;
    name: string;
    fname?: string;
    t: string;
    msgs?: number;
    topic?: string;
    description?: string;
    ts?: string;
    default?: boolean;
    ro?: boolean;
    u?: { _id?: string; username?: string; name?: string };
  }

  interface RocketChatMessage {
    _id: string;
    msg: string;
    _updatedAt?: string;
    t?: string; // тип сообщения (например, удалённое, системное и т.п.)
  }

  interface RocketChatEmoji {
    _id: string;
    name: string;
    aliases?: string[];
    extension?: string;
    _updatedAt?: string;
  }
  
  const RC_FETCH_TIMEOUT_MS = 30_000;

  function wrapRcFetchError(error: unknown, context: string): Error {
    const code =
      error && typeof error === 'object' && 'cause' in error
        ? (error as { cause?: { code?: string } }).cause?.code
        : error && typeof error === 'object' && 'code' in error
          ? String((error as { code: string }).code)
          : undefined;

    if (error instanceof Error && error.name === 'AbortError') {
      return new Error(
        `Connection timeout: Rocket.Chat server is not responding (${context}). Check VPN, network, and server URL.`
      );
    }
    if (code === 'UND_ERR_CONNECT_TIMEOUT' || code === 'ETIMEDOUT') {
      return new Error(
        `Connection timeout: Rocket.Chat server is not responding (${context}). Check VPN, network, and server URL.`
      );
    }
    if (error instanceof Error && error.message.includes('fetch failed')) {
      return new Error(`Network error: Cannot connect to Rocket.Chat (${context}).`);
    }
    return new Error(
      `Failed to ${context}: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }

  export class RocketChatClient {
    private baseUrl: string;
    private authToken: string | null = null;
    private userId: string | null = null;
  
    constructor(baseUrl: string) {
      this.baseUrl = baseUrl.replace(/\/$/, '');
    }

    private async rcFetch(
      path: string,
      init: RequestInit & { authToken: string; userId: string },
      timeoutMs = RC_FETCH_TIMEOUT_MS
    ): Promise<Response> {
      const { authToken, userId, ...rest } = init;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
      try {
        return await fetch(`${this.baseUrl}${path}`, {
          ...rest,
          headers: {
            ...(rest.headers as Record<string, string> | undefined),
            'X-Auth-Token': authToken,
            'X-User-Id': userId,
          },
          signal: controller.signal,
        });
      } catch (error) {
        throw wrapRcFetchError(error, path);
      } finally {
        clearTimeout(timeoutId);
      }
    }
  
    /**
     * @param totpCode — одноразовый код 2FA (приложение-аутентификатор), если требуется
     */
    async login(
      username: string,
      password: string,
      totpCode?: string
    ): Promise<{ authToken: string; userId: string }> {
      try {
        const payload: Record<string, string> = { user: username, password };
        if (totpCode?.trim()) {
          payload.code = totpCode.trim();
        }

        const response = await fetch(`${this.baseUrl}/api/v1/login`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(RC_FETCH_TIMEOUT_MS),
        });

        const errorData = await response.json().catch(() => ({}));

        if (!response.ok) {
          const errStr = JSON.stringify(errorData).toLowerCase();
          const errType = String(errorData.errorType || errorData.error || '').toLowerCase();
          if (
            errType.includes('totp-required') ||
            errStr.includes('totp-required') ||
            (errStr.includes('totp') && errStr.includes('required'))
          ) {
            const e = new RocketChatApiError('TOTP_REQUIRED', response.status, '/api/v1/login', 'totp-required');
            throw e;
          }
          const msg =
            errorData.message ||
            errorData.error ||
            errorData.reason ||
            (typeof errorData.details === 'string' ? errorData.details : null) ||
            `Login failed: ${response.statusText}`;
          throw new RocketChatApiError(String(msg), response.status, '/api/v1/login', errType);
        }

        const data: RocketChatLoginResponse = errorData as RocketChatLoginResponse;

        if (!data.data?.authToken || !data.data?.userId) {
          throw new RocketChatApiError('Invalid login response', 502, '/api/v1/login');
        }

        this.authToken = data.data.authToken;
        this.userId = data.data.userId;

        return {
          authToken: this.authToken,
          userId: this.userId,
        };
      } catch (error) {
        if (error instanceof RocketChatApiError) {
          throw error;
        }
        throw new Error(`Failed to login to Rocket.Chat: ${error instanceof Error ? error.message : 'Unknown error'}`, { cause: error });
      }
    }
  
    /** Validate an explicitly supplied token without a password login or storing it. */
    async authenticatePersonalAccessToken(authToken: string, userId: string): Promise<{ authToken: string; userId: string }> {
      const response = await this.rcFetch('/api/v1/me', { method: 'GET', authToken, userId });
      const data = await this.readCatalogueResponse(response, '/api/v1/me');
      if (data._id !== userId) throw new RocketChatApiError('Invalid token identity', 401, '/api/v1/me');
      return { authToken, userId };
    }

    async testConnection(authToken: string, userId: string): Promise<boolean> {
      try {
        const response = await fetch(`${this.baseUrl}/api/v1/me`, {
          method: 'GET',
          headers: {
            'X-Auth-Token': authToken,
            'X-User-Id': userId,
          },
        });

        return response.ok;
      } catch (error) {
        console.error('RocketChat connection test error:', error);
        return false;
      }
    }

    /**
     * Личный токен доступа (Personal Access Token): те же заголовки X-Auth-Token / X-User-Id,
     * что и после login. В RC при создании токена можно отключить требование 2FA для API.
     */
    static async validatePersonalAccessToken(
      baseUrl: string,
      token: string,
      rocketChatUserId: string,
    ): Promise<void> {
      const client = new RocketChatClient(baseUrl.replace(/\/$/, ''));
      const ok = await client.testConnection(token.trim(), rocketChatUserId.trim());
      if (!ok) {
        throw new Error(
          'Не удалось проверить токен. Убедитесь в URL сервера, вставьте полный токен и ваш User ID из Rocket.Chat (Мой аккаунт → ID пользователя).',
        );
      }
    }
  
    async getChannels(authToken: string, userId: string): Promise<RocketChatChannel[]> {
      try {
        this.authToken = authToken;
        this.userId = userId;
  
        /** Только каналы, где пользователь состоит: public — channels.list.joined; private — groups.list */
        const [publicChannels, privateChannels] = await Promise.all([
          this.fetchChannelList('/api/v1/channels.list.joined'),
          this.fetchChannelList('/api/v1/groups.list'),
        ]);
  
        return [...publicChannels, ...privateChannels];
      } catch (error) {
        console.error('RocketChat get channels error:', error);
        throw new Error(`Failed to fetch channels: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }
  
    private async fetchChannelList(endpoint: string): Promise<RocketChatChannel[]> {
      if (!this.authToken || !this.userId) {
        throw new Error('Not authenticated');
      }

      const response = await this.rcFetch(endpoint, {
        method: 'GET',
        authToken: this.authToken,
        userId: this.userId,
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch channels: ${response.statusText}`);
      }

      const data = await response.json();
      return (data.channels || data.groups || []) as RocketChatChannel[];
    }
  
    async sendMessage(
      authToken: string,
      userId: string,
      channelId: string,
      message: string
    ): Promise<{ messageId?: string }> {
      try {
        const response = await fetch(`${this.baseUrl}/api/v1/chat.postMessage`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Auth-Token': authToken,
            'X-User-Id': userId,
          },
          body: JSON.stringify({
            roomId: channelId,
            text: message,
          }),
        });
  
        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.error || `Failed to send message: ${response.statusText}`);
        }

        const data = await response.json();
        return {
          messageId: data.message?._id || data.messageId,
        };
      } catch (error) {
        console.error('RocketChat send message error:', error);
        throw new Error(`Failed to send message: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }

    async editMessage(
      authToken: string,
      userId: string,
      roomId: string,
      messageId: string,
      message: string
    ): Promise<void> {
      try {
        // Создаем AbortController для таймаута (30 секунд)
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000);
        
        const response = await fetch(`${this.baseUrl}/api/v1/chat.update`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Auth-Token': authToken,
            'X-User-Id': userId,
          },
          body: JSON.stringify({
            roomId: roomId,
            msgId: messageId,
            text: message,
          }),
          signal: controller.signal,
        });
        
        clearTimeout(timeoutId);
  
        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.error || `Failed to edit message: ${response.statusText}`);
        }
      } catch (error: any) {
        console.error('RocketChat edit message error:', error);
        
        // Более информативные сообщения об ошибках
        if (error.name === 'AbortError' || error.code === 'UND_ERR_CONNECT_TIMEOUT') {
          throw new Error(`Connection timeout: Rocket.Chat server is not responding. Please check your network connection and server availability.`);
        } else if (error.message?.includes('fetch failed')) {
          throw new Error(`Network error: Cannot connect to Rocket.Chat server. Please check if the server is accessible.`);
        } else {
          throw new Error(`Failed to edit message: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
      }
    }

    async getMessage(
      authToken: string,
      userId: string,
      messageId: string
    ): Promise<RocketChatMessage | null> {
      try {
        const response = await fetch(`${this.baseUrl}/api/v1/chat.getMessage?msgId=${encodeURIComponent(messageId)}`, {
          method: 'GET',
          headers: {
            'X-Auth-Token': authToken,
            'X-User-Id': userId,
          },
        });

        if (!response.ok) {
          // Если сообщение не найдено или недоступно, считаем что его нет (могло быть удалено)
          const text = await response.text().catch(() => '');
          console.warn('RocketChat getMessage response not ok:', response.status, text);
          return null;
        }

        const data = await response.json().catch(() => null);
        if (!data || !data.message) {
          return null;
        }

        return data.message as RocketChatMessage;
      } catch (error) {
        console.error('RocketChat getMessage error:', error);
        return null;
      }
    }

    /**
     * Одна страница истории канала (новые сверху). type 'p' — приватная группа.
     * При 429 ждёт и повторяет до 3 раз.
     */
    async getRoomHistoryPage(
      authToken: string,
      userId: string,
      room: { id: string; type: 'c' | 'p' },
      opts: { oldest: Date; latest: Date; count: number }
    ): Promise<Record<string, unknown>[]> {
      const endpoint = room.type === 'p' ? '/api/v1/groups.history' : '/api/v1/channels.history';
      const qs = new URLSearchParams({
        roomId: room.id,
        oldest: opts.oldest.toISOString(),
        latest: opts.latest.toISOString(),
        count: String(opts.count),
        inclusive: 'true',
      });
      for (let attempt = 0; ; attempt++) {
        const response = await this.rcFetch(`${endpoint}?${qs}`, { method: 'GET', authToken, userId });
        if (response.status === 429 && attempt < 3) {
          await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
          continue;
        }
        const data = await response.json().catch(() => ({}));
        if (!response.ok || data.success === false) {
          throw new RocketChatApiError(String(data.error || response.statusText || 'history failed'), response.status, endpoint, data.errorType);
        }
        return Array.isArray(data.messages) ? data.messages : [];
      }
    }

    /** Логины пользователей с ролью (нужно право access-permissions; при отказе — null). */
    async getUsernamesInRole(authToken: string, userId: string, role: string): Promise<string[] | null> {
      try {
        const response = await this.rcFetch(
          `/api/v1/roles.getUsersInRole?role=${encodeURIComponent(role)}&count=500`,
          { method: 'GET', authToken, userId }
        );
        if (!response.ok) return null;
        const data = await response.json().catch(() => null);
        if (!data || !Array.isArray(data.users)) return null;
        return data.users.map((u: { username?: string }) => u.username).filter(Boolean);
      } catch {
        return null;
      }
    }

    /** Список кастомных эмодзи (с ошибкой при сбое API). */
    async fetchCustomEmojis(authToken: string, userId: string): Promise<RocketChatEmoji[]> {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);
      try {
        const veryOldDate = '1970-01-01T00:00:00.000Z';
        const response = await fetch(
          `${this.baseUrl}/api/v1/emoji-custom.list?updatedSince=${veryOldDate}`,
          {
            method: 'GET',
            headers: {
              'X-Auth-Token': authToken,
              'X-User-Id': userId,
            },
            signal: controller.signal,
          }
        );
        clearTimeout(timeoutId);

        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          throw new Error(data.error || data.message || response.statusText);
        }

        const data = await response.json();
        const emojisList: RocketChatEmoji[] = Array.isArray(data.emojis?.update)
          ? (data.emojis.update as RocketChatEmoji[])
          : [];

        return emojisList.sort((a, b) => {
          const aTime = a._updatedAt ? new Date(a._updatedAt).getTime() : 0;
          const bTime = b._updatedAt ? new Date(b._updatedAt).getTime() : 0;
          return aTime - bTime || a.name.localeCompare(b.name);
        });
      } catch (error: unknown) {
        clearTimeout(timeoutId);
        throw wrapRcFetchError(error, 'fetch custom emojis');
      }
    }

    async getEmojis(authToken: string, userId: string): Promise<RocketChatEmoji[]> {
      try {
        return await this.fetchCustomEmojis(authToken, userId);
      } catch (error: any) {
        console.error('RocketChat get emojis error:', error);
        return [];
      }
    }

    /** Список имён существующих кастомных эмодзи (для импорта). */
    async getExistingEmojiNames(authToken: string, userId: string): Promise<string[]> {
      const emojis = await this.getEmojis(authToken, userId);
      return emojis.map((e) => e.name);
    }

    /** Создать кастомный эмодзи (загрузка файла). Требуются права админа. */
    async createEmoji(
      authToken: string,
      userId: string,
      name: string,
      imageBuffer: Buffer,
      filename: string,
      contentType: string
    ): Promise<{ success: boolean; error?: string }> {
      try {
        const formData = new FormData();
        formData.append('name', name);
        formData.append('aliases', '');
        const blob = new Blob([new Uint8Array(imageBuffer)], { type: contentType });
        formData.append('emoji', blob, filename);

        const response = await fetch(`${this.baseUrl}/api/v1/emoji-custom.create`, {
          method: 'POST',
          headers: {
            'X-Auth-Token': authToken,
            'X-User-Id': userId,
          },
          body: formData,
        });

        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          return { success: false, error: data.error || response.statusText };
        }
        if (data.success !== true) {
          return { success: false, error: data.error || 'Unknown error' };
        }
        return { success: true };
      } catch (error: any) {
        return { success: false, error: error?.message || 'Upload failed' };
      }
    }

    /** Удалить кастомный эмодзи. Требуется право manage-emoji. */
    async deleteEmoji(
      authToken: string,
      userId: string,
      emojiId: string
    ): Promise<{ success: boolean; error?: string }> {
      try {
        const response = await fetch(`${this.baseUrl}/api/v1/emoji-custom.delete`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Auth-Token': authToken,
            'X-User-Id': userId,
          },
          body: JSON.stringify({ emojiId }),
        });

        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          return { success: false, error: data.error || response.statusText };
        }
        if (data.success !== true) {
          return { success: false, error: data.error || 'Unknown error' };
        }
        return { success: true };
      } catch (error: unknown) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Delete failed',
        };
      }
    }

    /** Создать пользователя в Rocket.Chat (требуются права админа). */
    async createUser(
      authToken: string,
      userId: string,
      params: {
        email: string;
        name: string;
        username: string;
        password: string;
        requirePasswordChange?: boolean;
        verified?: boolean;
      }
    ): Promise<{ success: boolean; userId?: string; error?: string }> {
      try {
        const response = await fetch(`${this.baseUrl}/api/v1/users.create`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Auth-Token': authToken,
            'X-User-Id': userId,
          },
          body: JSON.stringify({
            email: params.email,
            name: params.name,
            username: params.username,
            password: params.password,
            requirePasswordChange: params.requirePasswordChange ?? false,
            verified: params.verified ?? true,
            sendWelcomeEmail: false,
          }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          return { success: false, error: data.error || response.statusText };
        }
        if (data.success !== true) {
          return { success: false, error: data.error || data.message || 'Unknown error' };
        }
        const createdUserId = data.user?._id ?? data.user?.id;
        return { success: true, userId: createdUserId };
      } catch (error: any) {
        return { success: false, error: error?.message || 'Create user failed' };
      }
    }

    /** Информация о пользователе (lastLogin и др.). */
    async getUserInfo(
      authToken: string,
      userId: string,
      rcUserId: string
    ): Promise<{ lastLogin?: string | null; username?: string } | null> {
      try {
        const response = await fetch(
          `${this.baseUrl}/api/v1/users.info?userId=${encodeURIComponent(rcUserId)}`,
          {
            method: 'GET',
            headers: {
              'X-Auth-Token': authToken,
              'X-User-Id': userId,
            },
          }
        );
        if (!response.ok) return null;
        const data = await response.json().catch(() => ({}));
        const u = data.user ?? data;
        return {
          lastLogin: u.lastLogin ?? null,
          username: u.username ?? u.name,
        };
      } catch {
        return null;
      }
    }

    /** Пригласить пользователей в публичный канал (channels.invite). */
    async inviteUsersToChannel(
      authToken: string,
      userId: string,
      roomId: string,
      userIds: string[]
    ): Promise<{ success: boolean; error?: string }> {
      try {
        const response = await fetch(`${this.baseUrl}/api/v1/channels.invite`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Auth-Token': authToken,
            'X-User-Id': userId,
          },
          body: JSON.stringify({ roomId, userId: userIds[0] }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) return { success: false, error: data.error || response.statusText };
        return { success: data.success === true };
      } catch (error: any) {
        return { success: false, error: error?.message || 'Invite failed' };
      }
    }

    /** Пригласить пользователей в приватную группу (groups.invite). */
    async inviteUsersToGroup(
      authToken: string,
      userId: string,
      roomId: string,
      userIds: string[]
    ): Promise<{ success: boolean; error?: string }> {
      try {
        const response = await fetch(`${this.baseUrl}/api/v1/groups.invite`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Auth-Token': authToken,
            'X-User-Id': userId,
          },
          body: JSON.stringify({ roomId, userId: userIds[0] }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) return { success: false, error: data.error || response.statusText };
        return { success: data.success === true };
      } catch (error: any) {
        return { success: false, error: error?.message || 'Invite failed' };
      }
    }

    /** Пригласить одного пользователя в комнату (канал или группа по типу). */
    async inviteUserToRoom(
      authToken: string,
      userId: string,
      roomId: string,
      roomType: 'c' | 'p',
      userToInviteId: string
    ): Promise<{ success: boolean; error?: string }> {
      if (roomType === 'p') {
        return this.inviteUsersToGroup(authToken, userId, roomId, [userToInviteId]);
      }
      return this.inviteUsersToChannel(authToken, userId, roomId, [userToInviteId]);
    }

    private async readCatalogueResponse(response: Response, endpoint: string): Promise<Record<string, unknown>> {
      const data = await response.json().catch(() => null);
      if (!response.ok || !data || typeof data !== 'object' || Array.isArray(data) || data.success === false || data.status === 'error') {
        const status = response.ok ? 502 : response.status;
        throw new RocketChatApiError(
          typeof data?.error === 'string' ? data.error : `Rocket.Chat request failed (${endpoint})`,
          status, endpoint, typeof data?.errorType === 'string' ? data.errorType : undefined,
        );
      }
      return data;
    }

    /** Public channels and accessible private groups for user provisioning, including all pages. */
    async getProvisioningChannels(authToken: string, userId: string): Promise<RocketChatChannel[]> {
      const load = async (endpoint: string, key: 'channels' | 'groups') => {
        const rooms: (RocketChatChannel & { archived?: boolean })[] = [];
        const count = 100;
        let offset = 0;
        while (true) {
          const response = await this.rcFetch(`${endpoint}?count=${count}&offset=${offset}&sort=${encodeURIComponent('{"name":1}')}`, {
            method: 'GET', authToken, userId,
          });
          const data = await this.readCatalogueResponse(response, endpoint);
          if (!Array.isArray(data[key])) throw new RocketChatApiError('Invalid channel list', 502, endpoint);
          const page = data[key] as (RocketChatChannel & { archived?: boolean })[];
          rooms.push(...page);
          offset += page.length;
          if (!page.length || (typeof data.total === 'number' ? offset >= data.total : page.length < count)) break;
        }
        return rooms.filter(room => !room.archived && (room.t === 'c' || room.t === 'p'));
      };
      const [channels, groups] = await Promise.all([
        load('/api/v1/channels.list', 'channels'), load('/api/v1/groups.list', 'groups'),
      ]);
      return [...new Map([...channels, ...groups].map(room => [room._id, room])).values()];
    }

    /** Список ролей (roles.list). */
    async listRoles(authToken: string, userId: string): Promise<{ _id: string; name: string; scope: string }[]> {
      const response = await this.rcFetch('/api/v1/roles.list', { method: 'GET', authToken, userId });
      const data = await this.readCatalogueResponse(response, '/api/v1/roles.list');
      if (!Array.isArray(data.roles)) throw new RocketChatApiError('Invalid role list', 502, '/api/v1/roles.list');
      return data.roles
        .map((role: { _id?: string; name?: string; description?: string; scope?: string }) => ({
          _id: role._id ?? '', name: role.name || role.description || role._id || '', scope: role.scope ?? 'Users',
        }))
        .filter((role: { _id: string }) => role._id);
    }

    /** Назначить роль пользователю (roles.addUserToRole). */
    async addUserToRole(
      authToken: string,
      userId: string,
      roleId: string,
      username: string
    ): Promise<{ success: boolean; error?: string }> {
      try {
        const response = await fetch(`${this.baseUrl}/api/v1/roles.addUserToRole`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Auth-Token': authToken,
            'X-User-Id': userId,
          },
          body: JSON.stringify({ roleId, username }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) return { success: false, error: data.error || response.statusText };
        return { success: data.success === true };
      } catch (error: any) {
        return { success: false, error: error?.message || 'Add role failed' };
      }
    }

    /** Список пользователей RC (users.list). Требуются права админа / view-full-other-user-info. */
    async listUsers(
      authToken: string,
      userId: string,
      options?: { count?: number; offset?: number }
    ): Promise<{ users: Array<{ _id: string; username?: string; name?: string; emails?: Array<{ address: string }>; lastLogin?: string }>; total: number }> {
      const count = options?.count ?? 100;
      const offset = options?.offset ?? 0;
      const response = await fetch(
        `${this.baseUrl}/api/v1/users.list?count=${count}&offset=${offset}`,
        {
          method: 'GET',
          headers: {
            'X-Auth-Token': authToken,
            'X-User-Id': userId,
          },
        }
      );
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || err.message || `users.list ${response.status}`);
      }
      const data = await response.json().catch(() => ({}));
      const users = (data.users ?? []).map((u: any) => ({
        _id: u._id ?? '',
        username: u.username ?? u.name,
        name: u.name,
        emails: u.emails,
        lastLogin: u.lastLogin ?? undefined,
        active: u.active !== false,
      }));
      return { users, total: data.total ?? users.length };
    }

    /** Все пользователи (постранично). */
    async listAllUsers(
      authToken: string,
      userId: string
    ): Promise<Array<{ _id: string; username?: string; name?: string; emails?: Array<{ address: string }>; lastLogin?: string; active?: boolean }>> {
      const out: Array<{ _id: string; username?: string; name?: string; emails?: Array<{ address: string }>; lastLogin?: string; active?: boolean }> = [];
      let offset = 0;
      const page = 100;
      for (;;) {
        const { users, total } = await this.listUsers(authToken, userId, { count: page, offset });
        out.push(...users);
        if (users.length < page || out.length >= total) break;
        offset += page;
      }
      return out;
    }

    /** Активировать / деактивировать пользователя (users.update с полем active). */
    async setUserActiveStatus(
      authToken: string,
      userId: string,
      targetUserId: string,
      active: boolean
    ): Promise<{ success: boolean; error?: string }> {
      try {
        const response = await fetch(`${this.baseUrl}/api/v1/users.update`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Auth-Token': authToken,
            'X-User-Id': userId,
          },
          body: JSON.stringify({
            userId: targetUserId,
            data: { active },
          }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) return { success: false, error: data.error || data.message || response.statusText };
        return { success: data.success === true };
      } catch (error: any) {
        return { success: false, error: error?.message || 'users.update active failed' };
      }
    }

    /**
     * Удалить пользователя (users.delete). Необратимо.
     * confirmRelinquish: true — сообщения остаются, владение комнатами снимается (иначе RC отказывает владельцу комнат).
     * Требуется право delete-user. `status` — HTTP-статус ответа (для обработки 401/403/429).
     */
    async deleteUser(
      authToken: string,
      userId: string,
      targetUserId: string,
      opts?: { confirmRelinquish?: boolean; timeoutMs?: number }
    ): Promise<{ success: boolean; error?: string; status?: number }> {
      try {
        const response = await this.rcFetch(
          '/api/v1/users.delete',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: targetUserId, confirmRelinquish: opts?.confirmRelinquish ?? true }),
            authToken,
            userId,
          },
          opts?.timeoutMs
        );
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          return { success: false, status: response.status, error: data.error || data.message || response.statusText };
        }
        return { success: data.success === true, status: response.status, error: data.success === true ? undefined : data.error };
      } catch (error: any) {
        return { success: false, error: error?.message || 'users.delete failed' };
      }
    }

    /**
     * Данные пользователя для безопасного удаления: роли и активность.
     * Различает «не найден» и ошибку доступа/сети (в отличие от getUserByUsername).
     */
    async getUserForRemoval(
      authToken: string,
      userId: string,
      target: { userId: string } | { username: string }
    ): Promise<
      | { state: 'found'; _id: string; username?: string; roles?: string[]; active?: boolean }
      | { state: 'not_found' }
      | { state: 'error'; error: string; status?: number }
    > {
      const query = 'userId' in target
        ? `userId=${encodeURIComponent(target.userId)}`
        : `username=${encodeURIComponent(target.username.replace(/^@/, ''))}`;
      try {
        const response = await this.rcFetch(`/api/v1/users.info?${query}`, { method: 'GET', authToken, userId });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          const text = String(data.errorType || data.error || data.message || '').toLowerCase();
          if (response.status === 404 || (response.status === 400 && (text.includes('invalid-user') || text.includes('not found')))) {
            return { state: 'not_found' };
          }
          return { state: 'error', status: response.status, error: data.error || data.message || response.statusText };
        }
        const u = data.user;
        if (!u?._id) return { state: 'not_found' };
        return {
          state: 'found',
          _id: u._id,
          username: u.username,
          roles: Array.isArray(u.roles) ? u.roles.map(String) : undefined,
          active: typeof u.active === 'boolean' ? u.active : undefined,
        };
      } catch (error: any) {
        return { state: 'error', error: error?.message || 'users.info failed' };
      }
    }

    /** Исключить пользователя из публичного канала. */
    async kickFromChannel(
      authToken: string,
      userId: string,
      roomId: string,
      targetUserId: string
    ): Promise<{ success: boolean; error?: string }> {
      try {
        const response = await fetch(`${this.baseUrl}/api/v1/channels.kick`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Auth-Token': authToken,
            'X-User-Id': userId,
          },
          body: JSON.stringify({ roomId, userId: targetUserId }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) return { success: false, error: data.error || data.message || response.statusText };
        return { success: data.success === true };
      } catch (error: any) {
        return { success: false, error: error?.message || 'channels.kick failed' };
      }
    }

    /** Исключить пользователя из приватной группы. */
    async kickFromGroup(
      authToken: string,
      userId: string,
      roomId: string,
      targetUserId: string
    ): Promise<{ success: boolean; error?: string }> {
      try {
        const response = await fetch(`${this.baseUrl}/api/v1/groups.kick`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Auth-Token': authToken,
            'X-User-Id': userId,
          },
          body: JSON.stringify({ roomId, userId: targetUserId }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) return { success: false, error: data.error || data.message || response.statusText };
        return { success: data.success === true };
      } catch (error: any) {
        return { success: false, error: error?.message || 'groups.kick failed' };
      }
    }

    async kickFromRoom(
      authToken: string,
      userId: string,
      roomId: string,
      roomType: 'c' | 'p',
      targetUserId: string
    ): Promise<{ success: boolean; error?: string }> {
      if (roomType === 'p') return this.kickFromGroup(authToken, userId, roomId, targetUserId);
      return this.kickFromChannel(authToken, userId, roomId, targetUserId);
    }

    /** Найти пользователя по username (users.info). */
    async getUserByUsername(
      authToken: string,
      userId: string,
      username: string
    ): Promise<{
      _id: string;
      username?: string;
      email?: string;
      lastLogin?: string;
      active?: boolean;
    } | null> {
      try {
        const response = await fetch(
          `${this.baseUrl}/api/v1/users.info?username=${encodeURIComponent(username.replace(/^@/, ''))}`,
          {
            method: 'GET',
            headers: {
              'X-Auth-Token': authToken,
              'X-User-Id': userId,
            },
          }
        );
        if (!response.ok) return null;
        const data = await response.json().catch(() => ({}));
        const u = data.user;
        if (!u?._id) return null;
        return {
          _id: u._id,
          username: u.username,
          email: u.emails?.[0]?.address,
          lastLogin: u.lastLogin,
          active: u.active,
        };
      } catch {
        return null;
      }
    }

    /** Обновить пароль пользователя в RC (users.update). Требуется право edit-other-user-password. */
    async updateUserPassword(
      authToken: string,
      userId: string,
      targetRcUserId: string,
      newPassword: string,
      requirePasswordChange?: boolean
    ): Promise<{ success: boolean; error?: string }> {
      const response = await fetch(`${this.baseUrl}/api/v1/users.update`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Auth-Token': authToken,
          'X-User-Id': userId,
        },
        body: JSON.stringify({
          userId: targetRcUserId,
          data: {
            password: newPassword,
            ...(requirePasswordChange !== undefined && { requirePasswordChange }),
          },
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) return { success: false, error: data.error || data.message || response.statusText };
      return { success: data.success === true, error: data.error };
    }

    /** Создать публичный канал (channels.create). */
    private async parseRcPostResponse(res: Response): Promise<{ ok: boolean; error?: string }> {
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        return { ok: false, error: String(data.error || data.message || res.statusText) };
      }
      if (data.success === false) {
        return { ok: false, error: String(data.error || 'Rocket.Chat вернул success: false') };
      }
      return { ok: true };
    }

    async createChannel(
      authToken: string,
      userId: string,
      name: string,
      options?: { readOnly?: boolean; topic?: string; description?: string }
    ): Promise<{ roomId: string; error?: string; warnings?: string[] }> {
      const res = await fetch(`${this.baseUrl}/api/v1/channels.create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Auth-Token': authToken, 'X-User-Id': userId },
        body: JSON.stringify({
          name: name.replace(/\s+/g, '_').replace(/^#/, ''),
          readOnly: options?.readOnly ?? false,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return { roomId: '', error: data.error || data.message || res.statusText };
      const roomId = data.channel?._id;
      if (!roomId) return { roomId: '', error: 'No roomId in response' };
      const warnings: string[] = [];
      if (options?.topic) {
        const t = await this.setChannelTopic(authToken, userId, roomId, options.topic);
        if (!t.ok) warnings.push(`тема: ${t.error || 'ошибка'}`);
      }
      if (options?.description) {
        const d = await this.setChannelDescription(authToken, userId, roomId, options.description);
        if (!d.ok) warnings.push(`описание: ${d.error || 'ошибка'}`);
      }
      return { roomId, ...(warnings.length ? { warnings } : {}) };
    }

    /** Создать приватный канал (groups.create). */
    async createGroup(
      authToken: string,
      userId: string,
      name: string,
      options?: { readOnly?: boolean; topic?: string; description?: string }
    ): Promise<{ roomId: string; error?: string; warnings?: string[] }> {
      const res = await fetch(`${this.baseUrl}/api/v1/groups.create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Auth-Token': authToken, 'X-User-Id': userId },
        body: JSON.stringify({
          name: name.replace(/\s+/g, '_').replace(/^#/, ''),
          readOnly: options?.readOnly ?? false,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return { roomId: '', error: data.error || data.message || res.statusText };
      const roomId = data.group?._id;
      if (!roomId) return { roomId: '', error: 'No roomId in response' };
      const warnings: string[] = [];
      if (options?.topic) {
        const t = await this.setGroupTopic(authToken, userId, roomId, options.topic);
        if (!t.ok) warnings.push(`тема: ${t.error || 'ошибка'}`);
      }
      if (options?.description) {
        const d = await this.setGroupDescription(authToken, userId, roomId, options.description);
        if (!d.ok) warnings.push(`описание: ${d.error || 'ошибка'}`);
      }
      return { roomId, ...(warnings.length ? { warnings } : {}) };
    }

    /** Установить канал как «по умолчанию» — новые пользователи автоматически присоединятся. */
    async setChannelDefault(authToken: string, userId: string, roomId: string, isDefault: boolean): Promise<{ ok: boolean; error?: string }> {
      const res = await fetch(`${this.baseUrl}/api/v1/channels.setDefault`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Auth-Token': authToken, 'X-User-Id': userId },
        body: JSON.stringify({ roomId, default: isDefault }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, error: data.error || data.message || res.statusText };
      return { ok: true };
    }

    /** Установить группу (приватный канал) как «по умолчанию». */
    async setGroupDefault(authToken: string, userId: string, roomId: string, isDefault: boolean): Promise<{ ok: boolean; error?: string }> {
      const res = await fetch(`${this.baseUrl}/api/v1/groups.setDefault`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Auth-Token': authToken, 'X-User-Id': userId },
        body: JSON.stringify({ roomId, default: isDefault }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, error: data.error || data.message || res.statusText };
      return { ok: true };
    }

    async setChannelTopic(
      authToken: string,
      userId: string,
      roomId: string,
      topic: string
    ): Promise<{ ok: boolean; error?: string }> {
      const res = await fetch(`${this.baseUrl}/api/v1/channels.setTopic`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Auth-Token': authToken, 'X-User-Id': userId },
        body: JSON.stringify({ roomId, topic }),
      });
      return this.parseRcPostResponse(res);
    }

    async setChannelDescription(
      authToken: string,
      userId: string,
      roomId: string,
      description: string
    ): Promise<{ ok: boolean; error?: string }> {
      const res = await fetch(`${this.baseUrl}/api/v1/channels.setDescription`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Auth-Token': authToken, 'X-User-Id': userId },
        body: JSON.stringify({ roomId, description }),
      });
      return this.parseRcPostResponse(res);
    }

    async setGroupTopic(
      authToken: string,
      userId: string,
      roomId: string,
      topic: string
    ): Promise<{ ok: boolean; error?: string }> {
      const res = await fetch(`${this.baseUrl}/api/v1/groups.setTopic`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Auth-Token': authToken, 'X-User-Id': userId },
        body: JSON.stringify({ roomId, topic }),
      });
      return this.parseRcPostResponse(res);
    }

    async setGroupDescription(
      authToken: string,
      userId: string,
      roomId: string,
      description: string
    ): Promise<{ ok: boolean; error?: string }> {
      const res = await fetch(`${this.baseUrl}/api/v1/groups.setDescription`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Auth-Token': authToken, 'X-User-Id': userId },
        body: JSON.stringify({ roomId, description }),
      });
      return this.parseRcPostResponse(res);
    }

    async setRoomTopic(
      authToken: string,
      userId: string,
      roomId: string,
      topic: string,
      isPrivate: boolean
    ): Promise<{ ok: boolean; error?: string }> {
      return isPrivate
        ? this.setGroupTopic(authToken, userId, roomId, topic)
        : this.setChannelTopic(authToken, userId, roomId, topic);
    }

    async setRoomDescription(
      authToken: string,
      userId: string,
      roomId: string,
      description: string,
      isPrivate: boolean
    ): Promise<{ ok: boolean; error?: string }> {
      return isPrivate
        ? this.setGroupDescription(authToken, userId, roomId, description)
        : this.setChannelDescription(authToken, userId, roomId, description);
    }

    /** Получить информацию о комнате (rooms.info). */
    async getRoomInfo(authToken: string, userId: string, roomId: string): Promise<{ room?: RocketChatChannel; error?: string }> {
      const res = await fetch(`${this.baseUrl}/api/v1/rooms.info?roomId=${encodeURIComponent(roomId)}`, {
        headers: { 'X-Auth-Token': authToken, 'X-User-Id': userId },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return { error: data.error || data.message || res.statusText };
      const room = data.room;
      return { room };
    }

    /** Найти комнату по имени (если channels.create вернул «уже существует»). */
    async getRoomInfoByName(
      authToken: string,
      userId: string,
      name: string,
      isPrivate: boolean
    ): Promise<{ roomId?: string; room?: RocketChatChannel; error?: string }> {
      const normalized = name.replace(/\s+/g, '_').replace(/^#/, '');
      const path = isPrivate
        ? `/api/v1/groups.info?roomName=${encodeURIComponent(normalized)}`
        : `/api/v1/channels.info?roomName=${encodeURIComponent(normalized)}`;
      try {
        const res = await this.rcFetch(path, { method: 'GET', authToken, userId });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          return { error: data.error || data.message || res.statusText };
        }
        const room = (data.channel || data.group) as RocketChatChannel | undefined;
        const roomId = room?._id;
        return roomId ? { roomId, room } : { error: 'roomId not in response' };
      } catch (error) {
        return { error: error instanceof Error ? error.message : 'Unknown error' };
      }
    }

    /** Сохранить настройки комнаты (rooms.saveRoomSettings). */
    async saveRoomSettings(
      authToken: string,
      userId: string,
      roomId: string,
      options: {
        /** Только массив типов для скрытия (REST API не принимает boolean). */
        systemMessages?: string[];
        readOnly?: boolean;
        default?: boolean;
      }
    ): Promise<{ success: boolean; error?: string }> {
      const body: Record<string, unknown> = { rid: roomId };
      if (options.systemMessages !== undefined) {
        body.systemMessages = options.systemMessages;
      }
      if (options.readOnly !== undefined) body.readOnly = options.readOnly;
      if (options.default !== undefined) body.default = options.default;

      const res = await fetch(`${this.baseUrl}/api/v1/rooms.saveRoomSettings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Auth-Token': authToken,
          'X-User-Id': userId,
        },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return { success: false, error: data.error || data.message || res.statusText };
      return { success: data.success !== false, error: data.success === false ? data.error : undefined };
    }
  }