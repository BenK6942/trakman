import { Repository } from '../../src/database/Repository.js'
import { MapIdsRepository } from '../../src/database/MapIdsRepository.js' 
import { Logger } from '../../src/Logger.js'

const mapIdsRepo = new MapIdsRepository() 
let mapPackId: number = -1
 
export class MapPacksRepository extends Repository {

  private async updateLiveSplitsMapPack(mapPackId: number, mapIds: number[]): Promise<void> {
    const liveSplitsUpdateQuery = `
      UPDATE livesplits
      SET map_pack_id = $1
      WHERE map_id = ANY($2::int[])
    `;
    await this.query(liveSplitsUpdateQuery, mapPackId, mapIds);
  }

  async insertIntoMapPacksTable(maps: tm.Map[]): Promise<void> {
    try {
      const mapUids: string[] = maps.map((row) => row.id);
      const mapIdAndUidArray = await mapIdsRepo.get(mapUids)
      const mapIds: number[] = mapIdAndUidArray.map((row) => (row.id));

      if (mapUids === undefined) {
        Logger.error(`[MapPacks] Failed to look up database IDs for Maps: ${mapUids}`)
        return
      }

      const indexExistsQuery = `
        SELECT map_pack_id FROM map_packs WHERE map_uid_array = $1;
      `;
      
      const indexExists = await this.query(indexExistsQuery,mapUids);
     
      const firstRow = indexExists?.[0];
      const existingMapPackIndex = (firstRow?.map_pack_id !== null && firstRow?.map_pack_id !== undefined) 
          ? Number(firstRow.map_pack_id) 
          : -1;
      
      if (existingMapPackIndex != -1){ 
        mapPackId = existingMapPackIndex
        Logger.info(`existingMapPackIndex: ${existingMapPackIndex}`)
       
        await this.updateLiveSplitsMapPack(mapPackId, mapIds);

        return //exit early (just sets liveplits mappack and nothing else)
      }
      else {
        const indexQuery = `
          SELECT COALESCE(MAX(map_pack_id), -1) + 1 AS new_index 
          FROM map_packs;
        `;
      
        const indexRows = await this.query(indexQuery);
        
        const firstRow = indexRows?.[0];
        const newMapPackIndex = (firstRow?.new_index !== null && firstRow?.new_index !== undefined) 
          ? Number(firstRow.new_index) 
          : 0;
        mapPackId = newMapPackIndex
        Logger.info(`newMapPackIndex: ${newMapPackIndex}`)
      }
      const query = `
        INSERT INTO map_packs (map_pack_id, map_id_array, map_uid_array) 
        ${this.getInsertValuesString(3, 1)};
      `
      const values: any[] = [mapPackId, mapIds, mapUids]
      await this.query(query, ...values)
      
      await this.updateLiveSplitsMapPack(mapPackId, mapIds); 

    } catch (error) {
      Logger.error(`[MapPacks] Error inserting record: ${(error as Error).message}`)
    }
  }
}