import { handleWorkspaceUserImport } from '@/lib/workspace-user-import';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return handleWorkspaceUserImport(request, id, true);
}
