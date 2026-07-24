import { supabase } from './supabase';

export type LocationDirectoryItem = {
  id: string;
  code: string;
  name: string;
  timezone: string;
  is_active: boolean;
};

export async function listActiveLocations(): Promise<LocationDirectoryItem[]> {
  if (!supabase) return [];

  const { data, error } = await supabase.rpc('list_active_location_directory');
  if (error) throw error;
  return (data ?? []) as LocationDirectoryItem[];
}

export async function getCurrentRole(): Promise<string | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.rpc('current_maxdock_role');
  if (error) throw error;
  return (data as string | null) ?? null;
}
