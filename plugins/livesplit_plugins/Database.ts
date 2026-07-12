export { }

const queries = [
  `CREATE TABLE IF NOT EXISTS livesplits(
    map_id INT4 NOT NULL, 
	map_uid varchar(50),
    player_id INT4 NOT NULL,
    player_login varchar(50),
    finish_time INT4,    
    personal_best_time INT4,
    PRIMARY KEY(map_id, player_id)
  );`
];

for (const e of queries) {
  await tm.db.query(e);
}

tm.addListener("Startup", async () => {
  await tm.db.query(`UPDATE livesplits SET finish_time = NULL;`);
});
