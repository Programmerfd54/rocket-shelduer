import { afterEach, describe, expect, it, vi } from 'vitest';
import { RocketChatClient } from '../rocketchat';

afterEach(() => vi.unstubAllGlobals());

describe('Rocket.Chat provisioning catalogues', () => {
  it('loads all channel pages and includes private groups but excludes archived rooms', async () => {
    const fetcher = vi.fn(async (input: string) => {
      const url = new URL(input);
      if (url.pathname === '/api/v1/groups.list') return Response.json({ success: true, groups: [{ _id: 'private', t: 'p' }], total: 1 });
      if (url.searchParams.get('offset') === '0') return Response.json({ success: true, channels: [
        { _id: 'one', t: 'c' }, { _id: 'archived', t: 'c', archived: true },
      ], total: 3 });
      expect(url.searchParams.get('offset')).toBe('2');
      return Response.json({ success: true, channels: [{ _id: 'two', t: 'c' }], total: 3 });
    });
    vi.stubGlobal('fetch', fetcher);
    const rooms = await new RocketChatClient('https://chat.example.test').getProvisioningChannels('token', 'admin');
    expect(rooms.map(room => room._id)).toEqual(['one', 'two', 'private']);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it('preserves role scope and labels standard roles that have no name', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ success: true, roles: [
      { _id: 'admin', description: 'Administrator', scope: 'Users' },
      { _id: 'moderator', scope: 'Subscriptions' },
      { _id: 'custom', name: 'Custom role', scope: 'Users' },
    ] })));
    expect(await new RocketChatClient('https://chat.example.test').listRoles('token', 'admin')).toEqual([
      { _id: 'admin', name: 'Administrator', scope: 'Users' },
      { _id: 'moderator', name: 'moderator', scope: 'Subscriptions' },
      { _id: 'custom', name: 'Custom role', scope: 'Users' },
    ]);
  });

  it('surfaces failed catalogue requests instead of claiming an empty successful load', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => Response.json({ success: false, error: 'Forbidden' }, { status: 403 })));
    const client = new RocketChatClient('https://chat.example.test');
    await expect(client.listRoles('token', 'admin')).rejects.toThrow('Forbidden');
    await expect(client.getProvisioningChannels('token', 'admin')).rejects.toThrow('Forbidden');
  });
});
