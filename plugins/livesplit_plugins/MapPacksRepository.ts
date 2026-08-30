import { Repository } from '../../src/database/Repository.js'
import { MapIdsRepository } from '../../src/database/MapIdsRepository.js' 
import { Logger } from '../../src/Logger.js'
import { LiveSplitsRepository } from './LiveSplitsRepository.js'

const mapIdsRepo = new MapIdsRepository() 
const liveSplitsRepo = new LiveSplitsRepository()
let mapPackId: number = -1

export class MapPacksRepository extends Repository {

  async insertIntoMapPacksTable(maps: tm.Map[]): Promise<void> {
    try {
      if (!maps || maps.length === 0) {
        Logger.warn('[MapPacks] Cannot insert an empty maps array.')
        return
      }

      const mapUids: string[] = maps.map((row) => row.id)
      const mapIdAndUidArray = await mapIdsRepo.get(mapUids)

      if (!mapIdAndUidArray || mapIdAndUidArray.length !== mapUids.length) {
        Logger.error(`[MapPacks] Failed to look up database IDs for Maps: ${mapUids}`)
        return
      }

      // Map returned database rows into a lookup dictionary
      const idMap = new Map<string, number>(
        mapIdAndUidArray.map((row) => [row.uid, row.id])
      )

      // Preserve strict input order for mapIds
      const mapIds: number[] = mapUids.map((uid) => idMap.get(uid)!)

      // Construct map_pack_name from first and last map names
      const firstName = maps[0].name
      const lastName = maps[maps.length - 1].name
      const mapPackName = maps.length === 1 ? firstName : `${firstName} - ${lastName}`

      // Check both arrays with PostgreSQL strict equality '='
      const indexExistsQuery = `
        SELECT map_pack_id 
        FROM map_packs 
        WHERE map_id_array = $1 AND map_uid_array = $2;
      `
      
      const indexExists = await this.query(indexExistsQuery, mapIds, mapUids)
     
      const firstRow = indexExists?.[0]
      const existingMapPackIndex = (firstRow?.map_pack_id !== null && firstRow?.map_pack_id !== undefined) 
          ? Number(firstRow.map_pack_id) 
          : -1
      
      if (existingMapPackIndex != -1){ 
        mapPackId = existingMapPackIndex
        Logger.info(`existingMapPackIndex: ${mapPackId}`)
       
        await liveSplitsRepo.createNewRowsForLoginOrUpdateMapPack(mapPackId, mapIds, mapUids)

        return //exit early (just sets livesplits mappack and nothing else)
      }
      else {
        const indexQuery = `
          SELECT COALESCE(MAX(map_pack_id), -1) + 1 AS new_index 
          FROM map_packs;
        `
      
        const indexRows = await this.query(indexQuery)
        
        const firstRow = indexRows?.[0]
        const newMapPackIndex = (firstRow?.new_index !== null && firstRow?.new_index !== undefined) 
          ? Number(firstRow.new_index) 
          : 0
        mapPackId = newMapPackIndex
        Logger.info(`newMapPackIndex: ${newMapPackIndex}`)
      }
      
      const query = `
        INSERT INTO map_packs (map_pack_id, map_pack_name, map_id_array, map_uid_array) 
        ${this.getInsertValuesString(4, 1)};
      `
      // Replaced the second 'mapPackId' with 'mapPackName'
      const values: any[] = [mapPackId, mapPackName, mapIds, mapUids]
      await this.query(query, ...values)
      
      await liveSplitsRepo.createNewRowsForLoginOrUpdateMapPack(mapPackId, mapIds, mapUids)

    } catch (error) {
      Logger.error(`[MapPacks] Error inserting record: ${(error as Error).message}`)
    }
  }
  
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }
  
  async addMapPackToJukebox(login: string, mapPackId: number): Promise<void> {
    try {
      
      tm.sendMessage(`$0F0[Map Packs] $FFFJuking all maps in the map pack, please wait for this to finish...`)

      const query = `
        SELECT map_uid_array 
        FROM map_packs 
        WHERE map_pack_id = $1;
      `
       
      const rows = await this.query(query, mapPackId)
      
      const mapUids: string[] = rows[0]?.map_uid_array ?? []

      if (mapUids.length === 0) {
        Logger.warn(`Map pack ID ${mapPackId} was not found or contains no maps.`)
        return
      }
    
      // Retrieve player details for the caller object (fallback to login if player is not found)
      const player = tm.players.get(login)
      const caller = player 
        ? { login: player.login, nickname: player.nickname } 
        : { login, nickname: login }

      Logger.info(`Queuing ${mapUids.length} map pack maps for player ${login}...`)

      let addedCount = 0
      for (const mapUid of mapUids) {
        try {
          // Add each map in order to the jukebox (setAsNextMap = false)
          const result = await tm.jukebox.add(mapUid, caller, false)
          
          if (result instanceof Error) {
            Logger.warn(`Could not add map ${mapUid}: ${result.message}`)
          } else if (result === false) {
            Logger.info(`Map ${mapUid} is already in the jukebox.`)
          } else {
            addedCount++
            Logger.trace(`Jukebox added map pack map: ${mapUid}`)
          }

          // CRITICAL: Force a small pause to keep the XML-RPC socket stable
          await this.sleep(75)

        } catch (callError: any) {
          Logger.error(`Failed to add map ${mapUid} via XML-RPC:`, callError?.message ?? callError)
          // Wait slightly longer if a network error occurs
          await this.sleep(500)
        }
      }
      tm.sendMessage(`$0F0[Map Packs] $FFFSuccessfully finished queuing ${addedCount} map pack maps sequentially.`)
      Logger.info(`Successfully finished queuing ${addedCount} map pack maps sequentially.`)

    } catch (error: any) {
      Logger.error("Failed to execute map pack auto-juke loader:", error?.message ?? error)
    }
  }
}