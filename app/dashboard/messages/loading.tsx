import { Loader2 } from 'lucide-react';

export default function MessagesLoading() {
  return (
    <div className="flex items-center justify-center min-h-[40vh]">
      <Loader2 className="w-8 h-8 animate-spin text-primary" />
    </div>
  );
}
