'use client';

/**
 * Auth Context - Backwards Compatibility Re-export
 *
 * This file re-exports from the new parent auth context for backwards compatibility.
 * All components should migrate to import directly from '@/lib/auth/auth-context'
 *
 * @deprecated Use '@/lib/auth/auth-context' instead
 */

export {
  AuthProvider,
  useAuth,
} from '@/lib/auth/auth-context';

// Re-export types if needed
export type { ParentAppUser } from '@/lib/auth/config';
