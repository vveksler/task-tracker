import { ProtectedRoute } from '@/components/auth/protected-route';
import { Navbar } from '@/components/ui/navbar';

interface WorkspacesLayoutProps {
  children: React.ReactNode;
}

const WorkspacesLayout: React.FC<WorkspacesLayoutProps> = ({ children }) => {
  return (
    <ProtectedRoute>
      <Navbar />
      <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
    </ProtectedRoute>
  );
};

export default WorkspacesLayout;
