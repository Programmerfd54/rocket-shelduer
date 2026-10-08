import { beforeEach, describe, expect, it, vi } from 'vitest';

const getCurrentUser = vi.fn();
vi.mock('@/lib/auth', () => ({ getCurrentUser: () => getCurrentUser() }));
const serveUploadedFile = vi.fn();
vi.mock('@/lib/uploaded-files', async (orig) => ({
  ...(await orig<typeof import('@/lib/uploaded-files')>()),
  serveUploadedFile: (...a: unknown[]) => serveUploadedFile(...a),
}));

import { GET } from '@/app/api/uploads/[bucket]/[name]/route';

const call = (bucket: string, name: string) =>
  GET(new Request(`http://x/api/uploads/${bucket}/${name}`), { params: Promise.resolve({ bucket, name }) });

describe('GET /api/uploads/[bucket]/[name] (help-uploads, avatars)', () => {
  beforeEach(() => {
    getCurrentUser.mockReset();
    serveUploadedFile.mockReset();
  });

  it('401 without a valid session, file is not touched', async () => {
    getCurrentUser.mockResolvedValue(null);
    const res = await call('help', 'help-1-a.png');
    expect(res.status).toBe(401);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(serveUploadedFile).not.toHaveBeenCalled();
  });

  it('404 for unknown bucket / unsafe name', async () => {
    getCurrentUser.mockResolvedValue({ id: 'u1' });
    expect((await call('none', 'none')).status).toBe(404);
    expect((await call('help', '..')).status).toBe(404);
    expect((await call('avatars', '.env')).status).toBe(404);
    expect(serveUploadedFile).not.toHaveBeenCalled();
  });

  it('serves the file for an authenticated user', async () => {
    getCurrentUser.mockResolvedValue({ id: 'u1' });
    serveUploadedFile.mockResolvedValue(new Response('img', { status: 200 }));
    const res = await call('avatars', 'u1.webp');
    expect(res.status).toBe(200);
    expect(serveUploadedFile).toHaveBeenCalledWith('avatars', 'u1.webp', expect.any(Request));
  });

  it('404 when the file does not exist', async () => {
    getCurrentUser.mockResolvedValue({ id: 'u1' });
    serveUploadedFile.mockResolvedValue(null);
    expect((await call('help', 'help-1-missing.png')).status).toBe(404);
  });
});
