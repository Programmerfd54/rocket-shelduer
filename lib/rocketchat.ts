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
  
  export class RocketChatClient {
    private baseUrl: string;
    private authToken: string | null = null;
    private userId: string | null = null;
  
    constructor(baseUrl: string) {
      this.baseUrl = baseUrl.replace(/\/$/, '');
    }
  
    async login(username: string, password: string): Promise<{ authToken: string; userId: string }> {
      try {
        const response = await fetch(`${this.baseUrl}/api/v1/login`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ user: username, password }),
        });
  
        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.message || `Login failed: ${response.statusText}`);
        }
  
        const data: RocketChatLoginResponse = await response.json();
  
        if (!data.data?.authToken || !data.data?.userId) {
          throw new Error('Invalid login response');
        }
  
        this.authToken = data.data.authToken;
        this.userId = data.data.userId;
  
        return {
          authToken: this.authToken,
          userId: this.userId,
        };
      } catch (error) {
        console.error('RocketChat login error:', error);
        throw new Error(`Failed to login to Rocket.Chat: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
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
  
    async getChannels(authToken: string, userId: string): Promise<RocketChatChannel[]> {
      try {
        this.authToken = authToken;
        this.userId = userId;
  
        const [publicChannels, privateChannels] = await Promise.all([
          this.fetchChannelList('/api/v1/channels.list'),
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
  
      const response = await fetch(`${this.baseUrl}${endpoint}`, {
        method: 'GET',
        headers: {
          'X-Auth-Token': this.authToken,
          'X-User-Id': this.userId,
        },
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

    async getEmojis(authToken: string, userId: string): Promise<RocketChatEmoji[]> {
      try {
        // Создаем AbortController для таймаута (10 секунд - эмодзи могут загружаться долго)
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);
        
        // Пробуем получить полный список эмодзи
        // API возвращает только изменения (update/remove), поэтому используем updatedSince
        // с очень старым значением, чтобы получить все эмодзи, которые были обновлены с того времени
        // Это должно вернуть все существующие эмодзи
        const veryOldDate = '1970-01-01T00:00:00.000Z';
        let response = await fetch(`${this.baseUrl}/api/v1/emoji-custom.list?updatedSince=${veryOldDate}`, {
          method: 'GET',
          headers: {
            'X-Auth-Token': authToken,
            'X-User-Id': userId,
          },
          signal: controller.signal,
        });
        
        clearTimeout(timeoutId);

        if (!response.ok) {
          const errorText = await response.text();
          console.error('RocketChat emoji API error:', response.status, errorText);
          throw new Error(`Failed to fetch emojis: ${response.statusText}`);
        }

        const data = await response.json();

        // Rocket.Chat возвращает эмодзи в формате { emojis: { update: [], remove: [] } }
        let emojisList: RocketChatEmoji[] = []
        if (data.emojis?.update && Array.isArray(data.emojis.update)) {
          emojisList = data.emojis.update as RocketChatEmoji[]
        }

        // Сортируем по популярности (по _updatedAt - последние использованные первыми)
        return emojisList.sort((a, b) => {
          const aTime = a._updatedAt ? new Date(a._updatedAt).getTime() : 0;
          const bTime = b._updatedAt ? new Date(b._updatedAt).getTime() : 0;
          return bTime - aTime; // Новые первыми
        });
      } catch (error: any) {
        console.error('RocketChat get emojis error:', error);
        // Возвращаем пустой массив если не удалось получить эмодзи
        // Это нормально - будут использоваться стандартные эмодзи
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

    /** Список ролей (roles.list). */
    async listRoles(authToken: string, userId: string): Promise<{ _id: string; name: string }[]> {
      try {
        const response = await fetch(`${this.baseUrl}/api/v1/roles.list`, {
          method: 'GET',
          headers: {
            'X-Auth-Token': authToken,
            'X-User-Id': userId,
          },
        });
        if (!response.ok) return [];
        const data = await response.json().catch(() => ({}));
        const list = data.roles ?? [];
        return list.map((r: { _id?: string; name?: string }) => ({ _id: r._id ?? '', name: r.name ?? '' })).filter((r: { _id: string }) => r._id);
      } catch {
        return [];
      }
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
  }