import { useAuth } from '../../context/AuthContext';

export default function ProfilePage() {
  const { user } = useAuth();

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-gray-900">Profile</h1>
      <dl className="rounded-lg border border-gray-200 bg-white p-4 text-sm">
        <div className="flex justify-between py-1">
          <dt className="text-gray-500">Email</dt>
          <dd className="text-gray-900">{user?.email}</dd>
        </div>
        <div className="flex justify-between py-1">
          <dt className="text-gray-500">Role</dt>
          <dd className="text-gray-900">{user?.role}</dd>
        </div>
        <div className="flex justify-between py-1">
          <dt className="text-gray-500">ID</dt>
          <dd className="font-mono text-xs text-gray-500">{user?.sub}</dd>
        </div>
      </dl>
      <p className="text-xs text-gray-400">Version {__APP_VERSION__}</p>
    </div>
  );
}
