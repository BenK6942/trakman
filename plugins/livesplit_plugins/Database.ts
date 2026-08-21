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
    finish_time INT4
  );`,
  `CREATE OR REPLACE VIEW v_pb_splits_total AS
    SELECT 
      map_pack_id,  
      player_id, 
      player_login, 
      sum(finish_time) as pb_total_run_time
    FROM map_pack_pb_splits
	  GROUP BY map_pack_id, player_id, player_login;` 
];

for (const e of queries) {
  await tm.db.query(e);
}

tm.addListener("Startup", async () => {
  await tm.db.query(`UPDATE livesplits SET finish_time = NULL;`); 
  await tm.db.query(`UPDATE livesplits SET map_pack_id = NULL;`);
});
	