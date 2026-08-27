export { }

const queries = [
  `CREATE TABLE IF NOT EXISTS livesplits(
	  map_pack_id INT4,
    map_id INT4 NOT NULL, 
	  map_uid varchar(50),
    player_id INT4 NOT NULL,
    player_login varchar(50),
    finish_time INT4,    
    personal_best_time INT4,
    PRIMARY KEY(map_id, player_id)
  );`,
  `CREATE TABLE IF NOT EXISTS map_packs(
    map_pack_id INT4 NOT NULL UNIQUE,
	  map_pack_name varchar(100),
	  map_id_array INT4[] NOT NULL UNIQUE,
	  map_uid_array TEXT[] UNIQUE
  );`,
  `CREATE TABLE IF NOT EXISTS map_pack_pb_splits(
	  map_pack_id INT4 NOT NULL, 
    map_id INT4 NOT NULL, 
    map_uid varchar(50), 
    player_id INT4 NOT NULL, 
    player_login varchar(50),
    finish_time INT4,
    PRIMARY KEY(map_pack_id, map_id, player_id)
  );`,
  `CREATE OR REPLACE VIEW v_pb_splits_total AS
    SELECT 
      map_pack_id,  
      player_id, 
      player_login, 
      sum(finish_time) as pb_total_run_time
    FROM map_pack_pb_splits
	  GROUP BY map_pack_id, player_id, player_login
  );`,
  `CREATE OR REPLACE VIEW v_pb_cumulative_splits AS
    WITH ordered_maps AS (
      SELECT 
        map_pack_id,
        map_id,
        ordinality AS map_order
      FROM map_packs,
      UNNEST(map_id_array) WITH ORDINALITY AS u(map_id, ordinality)
    ),
    splits_with_order AS (
      SELECT 
        s.map_pack_id,
        om.map_order,
        s.map_id,
        s.map_uid,
        s.player_id,
        s.player_login,
        s.finish_time,
        ARRAY_AGG(s.map_id) OVER (
          PARTITION BY s.map_pack_id, s.player_id 
          ORDER BY om.map_order
        ) AS maps_included,
        SUM(s.finish_time) OVER (
          PARTITION BY s.map_pack_id, s.player_id 
          ORDER BY om.map_order
        ) AS cumulative_time
      FROM map_pack_pb_splits s
      JOIN ordered_maps om 
        ON s.map_pack_id = om.map_pack_id 
      AND s.map_id = om.map_id
    )
    SELECT 
      map_pack_id,
      player_id,
      player_login,
      map_order,
      map_id,
      map_uid,
      finish_time AS map_time,
      cumulative_time,
      maps_included
    FROM splits_with_order
    ORDER BY map_pack_id, player_id, map_order;`
];

for (const e of queries) {
  await tm.db.query(e);
}

tm.addListener("Startup", async () => {
  await tm.db.query(`UPDATE livesplits SET finish_time = NULL;`); 
  await tm.db.query(`UPDATE livesplits SET map_pack_id = NULL;`);
});
	