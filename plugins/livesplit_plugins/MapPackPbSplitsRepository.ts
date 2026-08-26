import { Repository } from '../../src/database/Repository.js'
import { Logger } from '../../src/Logger.js'

export class MapPackPbSplitsRepository extends Repository {

  async saveMapPackPbIfBest(playerId: number): Promise<boolean> {
    try {
      const query = `
        WITH active_pack AS (
          SELECT map_pack_id 
          FROM livesplits 
          WHERE map_pack_id IS NOT NULL 
          LIMIT 1
        ),
        current_run AS (
          SELECT 
            l.map_pack_id,
            l.map_id,
            l.map_uid,
            l.player_id,
            l.player_login,
            l.finish_time,
            SUM(l.finish_time) OVER() as total_run_time,
            COUNT(*) OVER() as finish_count
          FROM livesplits l
          JOIN active_pack ap ON l.map_pack_id = ap.map_pack_id
          WHERE l.player_id = $1 
            AND l.finish_time IS NOT NULL
        ),
        expected_count AS (
          SELECT COUNT(*) as total_maps
          FROM livesplits l
          JOIN active_pack ap ON l.map_pack_id = ap.map_pack_id
          WHERE l.player_id = $1
        ),
        existing_pb AS (
          SELECT COALESCE(SUM(finish_time), 2147483647) as total_pb_time
          FROM map_pack_pb_splits mp
          JOIN active_pack ap ON mp.map_pack_id = ap.map_pack_id
          WHERE mp.player_id = $1
        ),
        inserted AS (
          INSERT INTO map_pack_pb_splits (map_pack_id, map_id, map_uid, player_id, player_login, finish_time)
          SELECT 
            cr.map_pack_id,
            cr.map_id,
            cr.map_uid,
            cr.player_id,
            cr.player_login,
            cr.finish_time
          FROM current_run cr
          CROSS JOIN expected_count ec
          CROSS JOIN existing_pb pb
          WHERE cr.finish_count = ec.total_maps
            AND cr.total_run_time < pb.total_pb_time
          ON CONFLICT (map_pack_id, map_id, player_id)
            DO UPDATE SET
            finish_time = EXCLUDED.finish_time
          RETURNING map_pack_id
        )
        SELECT COUNT(*) > 0 as updated FROM inserted;
      `

      const result = await this.query(query, playerId)
      const wasInserted = result[0]?.updated === true

      return wasInserted
    } catch (error) {
      Logger.error(`[LiveSplits] Error saving map pack PB: ${(error as Error).message}`)
      return false
    }
  }
}