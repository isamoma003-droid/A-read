// Super admins can do everything admins can, plus manage roles and site settings.
export const isAdmin = (user) => user?.role === 'admin' || user?.role === 'superadmin';
export const isSuperAdmin = (user) => user?.role === 'superadmin';
export const ROLE_LABELS = { user: 'Reader', admin: 'Admin', superadmin: 'Super admin' };
