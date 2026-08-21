import { Repository } from '../../src/database/Repository.js'
import { MapIdsRepository } from '../../src/database/MapIdsRepository.js'
import { PlayerRepository } from '../../src/database/PlayerRepository.js'
import { Logger } from '../../src/Logger.js'

const mapIdsRepo = new MapIdsRepository()
const playerRepo = new PlayerRepository()

export class MapPacksRepository extends Repository {

  async insertIntoMapPacksTable(maps: tm.Map[]): Promise<void> {
    try {
      const mapUids: string[] = maps.map((row) => row.id);
      const mapIdAndUidArray = await mapIdsRepo.get(mapUids)
      const mapIds: number[] = mapIdAndUidArray.map((row) => (row.id));

      if (mapUids === undefined) {
        Logger.error(`[MapPacks] Failed to look up database IDs for Maps: ${mapUids}`)
        return
      }

      const indexQuery = `
        SELECT COALESCE(MAX(map_pack_id), -1) + 1 AS new_index 
        FROM map_packs;
      `;
    
      const resultRows = await this.query(indexQuery);
      
      const firstRow = resultRows?.[0];
      const newMapPackIndex = (firstRow?.new_index !== null && firstRow?.new_index !== undefined) 
        ? Number(firstRow.new_index) 
        : 0;

      const query = `
        INSERT INTO map_packs (map_pack_id, map_id_array, map_uid_array) 
        ${this.getInsertValuesString(3, 1)};
      `
      const values: any[] = [newMapPackIndex, mapIds, mapUids]
      await this.query(query, ...values)

    } catch (error) {
      Logger.error(`[MapPacks] Error inserting record: ${(error as Error).message}`)
    }
  }
}
