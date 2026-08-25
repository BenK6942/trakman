import { Repository } from '../../src/database/Repository.js'
import { MapIdsRepository } from '../../src/database/MapIdsRepository.js'
import { PlayerRepository } from '../../src/database/PlayerRepository.js'
import { Logger } from '../../src/Logger.js'

const mapIdsRepo = new MapIdsRepository()
const playerRepo = new PlayerRepository()

export class LiveSplitsRepository extends Repository {
  
  async createNewRowsForLoginOrUpdateMapPack(mapPackId: number, mapIds: number[], mapUids: string[]): Promise<void> {
    try {
      const currentPlayers = tm.players.list
      const playerIds: number[] = []
      const playerLogins: string[] = []
      for (const player of currentPlayers) {
        const dbPlayerId = await playerRepo.getId(player.login) 
        if (dbPlayerId !== undefined) {
          playerIds.push(dbPlayerId)
          playerLogins.push(player.login)
        } else {
          Logger.warn(`[LiveSplits] No database ID found for player: ${player.login}`)
        }
      }

      const query = `
        WITH maps AS (
          SELECT id, uid
          FROM UNNEST($2::int[], $3::text[]) WITH ORDINALITY AS m(id, uid, ord)
        ),
        players AS (
          SELECT id, login
          FROM UNNEST($4::int[], $5::text[]) WITH ORDINALITY AS p(id, login, ord)
        )
        INSERT INTO livesplits (map_pack_id, map_id, map_uid, player_id, player_login)
        SELECT 
          $1, 
          m.id, 
          m.uid, 
          p.id, 
          p.login
        FROM maps m
        CROSS JOIN players p
        ON CONFLICT (map_id, player_id)
        DO UPDATE SET
          map_pack_id = EXCLUDED.map_pack_id; 
      `

      await this.query(query, mapPackId, mapIds, mapUids, playerIds, playerLogins)

    } catch (error) {
      Logger.error(`[LiveSplits] Error adding new rows for all players or updating map pack: ${(error as Error).message}`)
    }
  }

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
