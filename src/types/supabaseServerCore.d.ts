// @supabase/server's package.json "exports" field maps the "./core" subpath
// to dual .d.mts/.d.cts declarations that TypeScript's "node" moduleResolution
// (this project's setting — see tsconfig.json) can't resolve, even though
// Node's own runtime resolution handles it fine. Switching moduleResolution
// to "node16"/"nodenext"/"bundler" would fix this properly but changes
// resolution semantics for every relative import in the project — too broad
// a change just to unblock one subpath import. This shim covers only the
// one function actually used (src/lib/supabaseStorage.ts).
declare module '@supabase/server/core' {
  import { SupabaseClient } from '@supabase/supabase-js';

  interface CreateAdminClientOptions {
    env?: Record<string, unknown>;
  }

  export function createAdminClient<Database = unknown>(
    options?: CreateAdminClientOptions
  ): SupabaseClient<Database>;
}
