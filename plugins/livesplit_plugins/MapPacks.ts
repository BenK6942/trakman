import './ui/MapPackWidget.component.js' 

export interface MapPack {
  id: number
  name: string
  mapIds: number[]
  mapUids: string[]
}

let packs: MapPack[] = []

async function initialize(): Promise<void> {
  try {
    const query = `SELECT map_pack_id, map_pack_name, map_id_array, map_uid_array FROM map_packs;`
    const res = await tm.db.query(query)
    
    if (!Array.isArray(res)) {
      tm.log.error('MapPacks Query Error:', res)
      return
    }

    packs = res.map((row: any) => ({
      id: row.map_pack_id,
      name: row.map_pack_name,
      mapIds: row.map_id_array ?? [],
      mapUids: row.map_uid_array ?? []
    }))

    tm.log.info(`[MapPacks] Loaded ${packs.length} map pack(s) from database.`)
  } catch (err) {
    tm.log.error('[MapPacks] Error during database query initialization:', err)
  }
}

tm.addListener('Startup', initialize)

export const mappacks = {
  /**
   * Queries the database for the latest map packs and updates memory cache.
   */
  async fetch(): Promise<readonly Readonly<MapPack>[]> {
    try {
      const query = `SELECT map_pack_id, map_pack_name, map_id_array, map_uid_array FROM map_packs;`
      const res = await tm.db.query(query)
      
      if (!Array.isArray(res)) {
        tm.log.error('MapPacks Query Error:', res)
        return packs
      }

      packs = res.map((row: any) => ({
        id: row.map_pack_id,
        name: row.map_pack_name ?? 'Unnamed Pack',
        mapIds: row.map_id_array ?? [],
        mapUids: row.map_uid_array ?? []
      }))
    } catch (err) {
      tm.log.error('[MapPacks] Error fetching map packs:', err)
    }

    return packs
  },

  /**
   * Returns cached map packs.
   */
  get(): readonly Readonly<MapPack>[] {
    return packs
  }
}