import { ErrorPage } from '@/components/_components/ErrorPage';

export default function NotFound() {
  return <ErrorPage type="not-found" showBackButton={false} logError={false} />;
}
