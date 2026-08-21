import { Repository } from '../../src/database/Repository.js'
import { MapIdsRepository } from '../../src/database/MapIdsRepository.js'
import { PlayerRepository } from '../../src/database/PlayerRepository.js'
import { Logger } from '../../src/Logger.js'

const mapIdsRepo = new MapIdsRepository()
const playerRepo = new PlayerRepository()

export class LiveSplitsRepository extends Repository {

  async insertOrUpdateIntoLivesplitsTable(mapUid: string, login: string, finishTime: number, personalBest: number): Promise<void> {
    try {
      const mapId = await mapIdsRepo.get(mapUid)
      const playerId = await playerRepo.getId(login)

      if (mapId === undefined || playerId === undefined) {
        Logger.error(`[LiveSplits] Failed to look up database IDs for Map: ${mapUid}, Player: ${login}`)
        return
      }

      const query = `
        INSERT INTO livesplits (map_id, map_Uid, player_id, player_login, finish_time, personal_best_time) 
        ${this.getInsertValuesString(6, 1)}
        ON CONFLICT (map_id, player_id) 
        DO UPDATE SET 
        finish_time = EXCLUDED.finish_time,
        personal_best_time = LEAST(livesplits.personal_best_time, EXCLUDED.finish_time);
      `

      const values: any[] = [mapId, mapUid, playerId, login, finishTime, personalBest]
      await this.query(query, ...values)

    } catch (error) {
      Logger.error(`[LiveSplits] Error inserting record: ${(error as Error).message}`)
    }
  }
  
}
